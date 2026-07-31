//! Recognising, and decoding, the one big image a scanned score page is.
//!
//! This is the half of the screen-resolution pipeline that touches PDF objects:
//! it decides whether a page really is "one image stretched over the page box"
//! and, if so, runs the right codec straight into a [`Downsampler`].
//!
//! Every check here is a *refusal* check. The caller has a correct, complete
//! renderer to fall back to, so the only unacceptable outcome is confidently
//! producing the wrong picture. Anything unfamiliar — a second image, any text,
//! a rotated placement, a stencil mask, an unsupported filter — returns `Err`.

use lopdf::{Dictionary, Document, Object, ObjectId, Stream};

use super::page_image::{downsample_buffer, target_size, Downsampler, Pixels};

/// How far the image placement matrix may deviate from axis-aligned.
///
/// Some scans are deskewed by the producer with a slightly rotated `cm` rather
/// than by resampling the bitmap — the Griffes IMSLP edition rotates its page
/// image by 0.42°. Painting that image without the rotation would displace its
/// corners by ~1% of the page width, about 15 px on screen, which would show up
/// as marks drifting off the staff they were drawn on. 0.6% keeps the worst
/// displacement under half of that; anything beyond it falls back to the real
/// renderer, which applies the matrix properly.
const AXIS_TOLERANCE: f64 = 0.006;

/// A decoded page bitmap at (or below) the requested screen resolution.
pub struct DecodedImage {
    pub pixels: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub kind: Pixels,
    pub source_width: u32,
    pub source_height: u32,
}

/// Hand-written so a failing assertion prints the shape rather than megabytes
/// of pixels.
impl std::fmt::Debug for DecodedImage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DecodedImage")
            .field("width", &self.width)
            .field("height", &self.height)
            .field("kind", &self.kind)
            .field("source_width", &self.source_width)
            .field("source_height", &self.source_height)
            .field("bytes", &self.pixels.len())
            .finish()
    }
}

/// Find the single full-page image XObject this page is made of.
pub fn single_image_of_page(document: &Document, page_id: ObjectId) -> Result<&Stream, String> {
    let content = document.get_page_content(page_id);
    let operations = lopdf::content::Content::decode(&content)
        .map_err(|e| format!("decode page content: {e}"))?;

    const IDENTITY: [f64; 6] = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];
    let mut name: Option<Vec<u8>> = None;
    let mut placement: Option<[f64; 6]> = None;
    let mut ctm = IDENTITY;
    let mut stack: Vec<[f64; 6]> = Vec::new();

    for operation in &operations.operations {
        match operation.operator.as_str() {
            "q" => stack.push(ctm),
            "Q" => ctm = stack.pop().unwrap_or(IDENTITY),
            "cm" => {
                if operation.operands.len() != 6 {
                    return Err("cm with unexpected arity".into());
                }
                let mut matrix = [0.0f64; 6];
                for (index, operand) in operation.operands.iter().enumerate() {
                    matrix[index] = numeric(operand).ok_or("non-numeric cm operand")?;
                }
                ctm = concat(&matrix, &ctm);
            }
            "Do" => {
                if name.is_some() {
                    return Err("page draws more than one XObject".into());
                }
                let Some(Object::Name(operand)) = operation.operands.first() else {
                    return Err("Do without an XObject name".into());
                };
                name = Some(operand.clone());
                placement = Some(ctm);
            }
            // Graphics state, path construction and clipping change nothing a
            // reader can see on a scan whose whole content is the image.
            "re" | "W" | "W*" | "n" | "ri" | "gs" | "cs" | "CS" | "sc" | "scn" | "SC" | "SCN"
            | "g" | "G" | "rg" | "RG" | "k" | "K" | "i" | "j" | "J" | "M" | "d" | "w" | "BDC"
            | "BMC" | "EMC" | "MP" | "DP" | "m" | "l" | "c" | "v" | "y" | "h" => {}
            // Anything that paints ink of its own (text, strokes, fills,
            // shadings, inline images) means the page is not just a scan.
            other => return Err(format!("page paints with operator '{other}'")),
        }
    }

    let (Some(name), Some(placement)) = (name, placement) else {
        return Err("page draws no XObject".into());
    };
    if placement[0].abs() <= f64::EPSILON || placement[3].abs() <= f64::EPSILON {
        return Err("page image is degenerate".into());
    }
    if placement[1].abs() > placement[3].abs() * AXIS_TOLERANCE
        || placement[2].abs() > placement[0].abs() * AXIS_TOLERANCE
    {
        return Err("page image is rotated or skewed".into());
    }

    let (inline, referenced) = document
        .get_page_resources(page_id)
        .map_err(|e| format!("page resources: {e}"))?;
    let mut dictionaries: Vec<&Dictionary> = Vec::new();
    if let Some(dictionary) = inline {
        dictionaries.push(dictionary);
    }
    for id in referenced {
        if let Ok(dictionary) = document.get_dictionary(id) {
            dictionaries.push(dictionary);
        }
    }

    for dictionary in dictionaries {
        let Ok(xobjects) = dictionary
            .get(b"XObject")
            .map(|object| resolve(document, object))
            .and_then(|object| object.as_dict())
        else {
            continue;
        };
        let Ok(entry) = xobjects.get(&name) else {
            continue;
        };
        let Ok(stream) = resolve(document, entry).as_stream() else {
            continue;
        };
        let subtype = stream
            .dict
            .get(b"Subtype")
            .ok()
            .and_then(|object| object.as_name().ok());
        if subtype != Some(b"Image") {
            return Err("page draws a form XObject, not an image".into());
        }
        return Ok(stream);
    }
    Err("the drawn XObject is not in the page resources".into())
}

/// Decode `stream` down to `requested_long_edge`.
pub fn decode_image(
    document: &Document,
    stream: &Stream,
    requested_long_edge: u32,
) -> Result<DecodedImage, String> {
    let dictionary = &stream.dict;
    let width = integer(document, dictionary, b"Width").ok_or("image without /Width")?;
    let height = integer(document, dictionary, b"Height").ok_or("image without /Height")?;
    if !(1..=u16::MAX as i64 * 4).contains(&width) || !(1..=u16::MAX as i64 * 4).contains(&height) {
        return Err("image dimensions are out of range".into());
    }
    let (width, height) = (width as u32, height as u32);
    if dictionary.has(b"SMask") || dictionary.has(b"Mask") {
        return Err("image carries a mask".into());
    }
    if boolean(document, dictionary, b"ImageMask").unwrap_or(false) {
        return Err("image is a stencil mask".into());
    }

    let (target_width, target_height) = target_size(width, height, requested_long_edge);
    let filters = filter_names(document, dictionary);
    let Some(filter) = filters.last() else {
        return Err("image has no filter this pipeline understands".into());
    };
    // `/Decode [1 0]` inverts a 1-component image.
    let inverted = matches!(
        dictionary.get(b"Decode").map(|object| resolve(document, object)),
        Ok(Object::Array(entries)) if entries.first().and_then(numeric) == Some(1.0)
    );

    match filter.as_slice() {
        b"DCTDecode" => decode_jpeg(
            &stream.content,
            width,
            height,
            target_width,
            target_height,
            inverted,
        ),
        b"JBIG2Decode" => decode_jbig2(
            &stream.content,
            jbig2_globals(document, dictionary)?.as_deref(),
            width,
            height,
            target_width,
            target_height,
            inverted,
        ),
        b"CCITTFaxDecode" => decode_ccitt(
            document,
            stream,
            width,
            height,
            target_width,
            target_height,
            inverted,
        ),
        other => Err(format!(
            "unsupported image filter '{}'",
            String::from_utf8_lossy(other)
        )),
    }
}

// ── PDF object helpers ───────────────────────────────────────────────────────

fn numeric(object: &Object) -> Option<f64> {
    match object {
        Object::Integer(value) => Some(*value as f64),
        Object::Real(value) => Some(*value as f64),
        _ => None,
    }
}

/// Follow indirect references. Real editions put scalars behind references —
/// the Griffes CCITT parameters are `/Columns 56 0 R` — so nothing may be read
/// without this. Bounded so a reference cycle cannot hang the pool thread.
fn resolve<'a>(document: &'a Document, object: &'a Object) -> &'a Object {
    let mut current = object;
    for _ in 0..8 {
        let Object::Reference(id) = current else {
            return current;
        };
        match document.get_object(*id) {
            Ok(next) => current = next,
            Err(_) => return current,
        }
    }
    current
}

fn integer(document: &Document, dictionary: &Dictionary, key: &[u8]) -> Option<i64> {
    dictionary
        .get(key)
        .ok()
        .and_then(|object| resolve(document, object).as_i64().ok())
}

fn boolean(document: &Document, dictionary: &Dictionary, key: &[u8]) -> Option<bool> {
    dictionary
        .get(key)
        .ok()
        .and_then(|object| resolve(document, object).as_bool().ok())
}

fn filter_names(document: &Document, dictionary: &Dictionary) -> Vec<Vec<u8>> {
    match dictionary
        .get(b"Filter")
        .map(|object| resolve(document, object))
    {
        Ok(Object::Name(name)) => vec![name.clone()],
        Ok(Object::Array(entries)) => entries
            .iter()
            .filter_map(|entry| resolve(document, entry).as_name().ok().map(<[u8]>::to_vec))
            .collect(),
        _ => Vec::new(),
    }
}

/// `a x b`, PDF's row-major 3x2 matrix product.
fn concat(a: &[f64; 6], b: &[f64; 6]) -> [f64; 6] {
    [
        a[0] * b[0] + a[1] * b[2],
        a[0] * b[1] + a[1] * b[3],
        a[2] * b[0] + a[3] * b[2],
        a[2] * b[1] + a[3] * b[3],
        a[4] * b[0] + a[5] * b[2] + b[4],
        a[4] * b[1] + a[5] * b[3] + b[5],
    ]
}

fn decode_parms(document: &Document, dictionary: &Dictionary, marker: &[u8]) -> Dictionary {
    match dictionary
        .get(b"DecodeParms")
        .map(|object| resolve(document, object))
    {
        Ok(Object::Dictionary(found)) => found.clone(),
        Ok(Object::Array(entries)) => entries
            .iter()
            .filter_map(|entry| resolve(document, entry).as_dict().ok())
            // A filter chain has one parameter dictionary per filter; pick the
            // one carrying this codec's key, else the last non-null.
            .find(|candidate| candidate.has(marker))
            .or_else(|| {
                entries
                    .iter()
                    .filter_map(|entry| resolve(document, entry).as_dict().ok())
                    .next_back()
            })
            .cloned()
            .unwrap_or_default(),
        _ => Dictionary::new(),
    }
}

// ── Codecs ───────────────────────────────────────────────────────────────────

/// The DCT scale request that makes `jpeg-decoder` reconstruct at 1/2, 1/4 or
/// 1/8 size instead of full size.
///
/// `jpeg-decoder` picks the smallest 1/8-step whose output is at least as large
/// as the request, so asking for exactly the size a given step produces selects
/// that step. Accepting an output 10% under target keeps the cheap step when it
/// lands just short (the Barber page: 1/2 gives 1970 px against a 2048 target,
/// a 4% difference nobody can see, for half the decode).
pub fn dct_request(width: u32, height: u32, target_long_edge: u32) -> (u32, u32) {
    let scaled = |length: u32, numerator: u32| (length * numerator).div_ceil(8);
    for numerator in [1u32, 2, 4] {
        let (candidate_width, candidate_height) =
            (scaled(width, numerator), scaled(height, numerator));
        if candidate_width.max(candidate_height) as f64 >= target_long_edge as f64 * 0.9 {
            return (candidate_width, candidate_height);
        }
    }
    (width, height)
}

fn decode_jpeg(
    data: &[u8],
    width: u32,
    height: u32,
    target_width: u32,
    target_height: u32,
    inverted: bool,
) -> Result<DecodedImage, String> {
    let mut decoder = jpeg_decoder::Decoder::new(std::io::Cursor::new(data));
    decoder
        .read_info()
        .map_err(|e| format!("read jpeg header: {e}"))?;
    let info = decoder.info().ok_or("jpeg without image info")?;
    let kind = match info.pixel_format {
        jpeg_decoder::PixelFormat::L8 => Pixels::Gray,
        jpeg_decoder::PixelFormat::RGB24 => Pixels::Rgb,
        // CMYK/L16 scans exist but need the PDF colour space to be interpreted
        // correctly; the real renderer already does that.
        other => return Err(format!("unsupported jpeg pixel format {other:?}")),
    };
    let (request_width, request_height) = dct_request(
        info.width as u32,
        info.height as u32,
        target_width.max(target_height),
    );
    let (decoded_width, decoded_height) = decoder
        .scale(request_width as u16, request_height as u16)
        .map_err(|e| format!("scale jpeg: {e}"))?;
    let mut pixels = decoder.decode().map_err(|e| format!("decode jpeg: {e}"))?;
    if inverted {
        for byte in &mut pixels {
            *byte = 255 - *byte;
        }
    }
    let expected = decoded_width as usize * decoded_height as usize * kind.channels();
    if pixels.len() < expected {
        return Err("jpeg decoded fewer pixels than its own header declares".into());
    }
    let pixels = downsample_buffer(
        &pixels,
        decoded_width as u32,
        decoded_height as u32,
        target_width.min(decoded_width as u32),
        target_height.min(decoded_height as u32),
        kind,
    );
    let (out_width, out_height) = (
        target_width.min(decoded_width as u32),
        target_height.min(decoded_height as u32),
    );
    Ok(DecodedImage {
        pixels,
        width: out_width,
        height: out_height,
        kind,
        source_width: width,
        source_height: height,
    })
}

/// Sink shared by both bilevel codecs: turns 1-bit runs into averaged gray.
struct BilevelSink {
    down: Downsampler,
    black: u8,
    white: u8,
}

impl BilevelSink {
    fn new(
        source_width: u32,
        source_height: u32,
        target_width: u32,
        target_height: u32,
        inverted: bool,
    ) -> Self {
        Self {
            down: Downsampler::new(
                source_width,
                source_height,
                target_width,
                target_height,
                Pixels::Gray,
            ),
            black: if inverted { 255 } else { 0 },
            white: if inverted { 0 } else { 255 },
        }
    }

    #[inline]
    fn shade(&self, black: bool) -> u8 {
        if black {
            self.black
        } else {
            self.white
        }
    }
}

impl hayro_jbig2::Decoder for BilevelSink {
    fn push_pixel(&mut self, black: bool) {
        let shade = self.shade(black);
        self.down.push_gray(shade);
    }
    fn push_pixel_chunk(&mut self, black: bool, chunk_count: u32) {
        let shade = self.shade(black);
        self.down
            .push_gray_run(shade, chunk_count.saturating_mul(8));
    }
    fn next_line(&mut self) {
        self.down.end_row();
    }
}

impl hayro_ccitt::Decoder for BilevelSink {
    fn push_pixel(&mut self, white: bool) {
        let shade = self.shade(!white);
        self.down.push_gray(shade);
    }
    fn push_pixel_chunk(&mut self, white: bool, chunk_count: u32) {
        let shade = self.shade(!white);
        self.down
            .push_gray_run(shade, chunk_count.saturating_mul(8));
    }
    fn next_line(&mut self) {
        self.down.end_row();
    }
}

fn jbig2_globals(document: &Document, dictionary: &Dictionary) -> Result<Option<Vec<u8>>, String> {
    let parms = decode_parms(document, dictionary, b"JBIG2Globals");
    let Ok(globals) = parms
        .get(b"JBIG2Globals")
        .map(|object| resolve(document, object))
    else {
        return Ok(None);
    };
    let stream = globals
        .as_stream()
        .map_err(|_| "JBIG2Globals is not a stream".to_string())?;
    Ok(Some(
        stream
            .decompressed_content()
            .unwrap_or_else(|_| stream.content.clone()),
    ))
}

fn decode_jbig2(
    data: &[u8],
    globals: Option<&[u8]>,
    width: u32,
    height: u32,
    target_width: u32,
    target_height: u32,
    inverted: bool,
) -> Result<DecodedImage, String> {
    let image =
        hayro_jbig2::Image::new_embedded(data, globals).map_err(|e| format!("parse jbig2: {e}"))?;
    if image.width() != width || image.height() != height {
        return Err("jbig2 dimensions disagree with the image dictionary".into());
    }
    let mut sink = BilevelSink::new(width, height, target_width, target_height, inverted);
    image
        .decode(&mut sink)
        .map_err(|e| format!("decode jbig2: {e}"))?;
    Ok(DecodedImage {
        pixels: sink.down.finish(),
        width: target_width,
        height: target_height,
        kind: Pixels::Gray,
        source_width: width,
        source_height: height,
    })
}

fn decode_ccitt(
    document: &Document,
    stream: &Stream,
    width: u32,
    height: u32,
    target_width: u32,
    target_height: u32,
    inverted: bool,
) -> Result<DecodedImage, String> {
    let parms = decode_parms(document, &stream.dict, b"K");
    let k = integer(document, &parms, b"K").unwrap_or(0);
    let columns = integer(document, &parms, b"Columns").unwrap_or(1728);
    let rows = integer(document, &parms, b"Rows").unwrap_or(height as i64);
    let black_is_one = boolean(document, &parms, b"BlackIs1").unwrap_or(false);
    if columns != width as i64 {
        return Err("ccitt /Columns disagrees with the image width".into());
    }
    // Semantic black stays black unless exactly one of BlackIs1 / `/Decode [1 0]`
    // flips it: BlackIs1 makes a 1 bit black while DeviceGray paints 1 as white,
    // so when both are present they cancel — which is exactly what the Cortot
    // edition does.
    let flipped = black_is_one != inverted;
    let mut sink = BilevelSink::new(width, height, target_width, target_height, flipped);
    let settings = hayro_ccitt::DecodeSettings {
        columns: width,
        rows: (rows.max(height as i64)).min(u32::MAX as i64) as u32,
        end_of_block: true,
        end_of_line: boolean(document, &parms, b"EndOfLine").unwrap_or(false),
        rows_are_byte_aligned: boolean(document, &parms, b"EncodedByteAlign").unwrap_or(false),
        encoding: match k {
            k if k < 0 => hayro_ccitt::EncodingMode::Group4,
            0 => hayro_ccitt::EncodingMode::Group3_1D,
            k => hayro_ccitt::EncodingMode::Group3_2D { k: k as u32 },
        },
        invert_black: false,
    };
    let mut context = hayro_ccitt::DecoderContext::new(settings);
    // A truncated fax stream still yields every row it managed to decode, and a
    // score page missing its last few rows beats no page at all.
    let _ = hayro_ccitt::decode(&stream.content, &mut sink, &mut context);
    Ok(DecodedImage {
        pixels: sink.down.finish(),
        width: target_width,
        height: target_height,
        kind: Pixels::Gray,
        source_width: width,
        source_height: height,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::content::{Content, Operation};
    use lopdf::dictionary;

    /// Build a one-page document whose content is `operations` and whose
    /// resources hold `image` under `/Im0`.
    fn document_with(operations: Vec<Operation>, image: Stream) -> (Document, ObjectId) {
        let mut document = Document::with_version("1.5");
        let image_id = document.add_object(Object::Stream(image));
        let content = Content { operations };
        let content_id =
            document.add_object(Stream::new(dictionary! {}, content.encode().unwrap()));
        let pages_id = document.new_object_id();
        let page_id = document.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "MediaBox" => vec![0.into(), 0.into(), 612.into(), 792.into()],
            "Contents" => content_id,
            "Resources" => dictionary! {
                "XObject" => dictionary! { "Im0" => image_id },
            },
        });
        document.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! {
                "Type" => "Pages",
                "Count" => 1,
                "Kids" => vec![page_id.into()],
            }),
        );
        let catalog_id = document.add_object(dictionary! {
            "Type" => "Catalog",
            "Pages" => pages_id,
        });
        document.trailer.set("Root", catalog_id);
        (document, page_id)
    }

    fn op(operator: &str, operands: Vec<Object>) -> Operation {
        Operation::new(operator, operands)
    }

    /// A tiny 8x8 gray JPEG built through our own encoder.
    fn jpeg_image(width: u32, height: u32) -> Stream {
        let mut pixels = vec![255u8; (width * height) as usize];
        for x in 0..width as usize {
            pixels[(height as usize / 2) * width as usize + x] = 0;
        }
        let jpeg = super::super::page_image::encode_jpeg(&pixels, width, height, Pixels::Gray, 90)
            .unwrap();
        let mut stream = Stream::new(
            dictionary! {
                "Type" => "XObject",
                "Subtype" => "Image",
                "Width" => width as i64,
                "Height" => height as i64,
                "ColorSpace" => "DeviceGray",
                "BitsPerComponent" => 8,
                "Filter" => "DCTDecode",
            },
            jpeg,
        );
        stream.allows_compression = false;
        stream
    }

    fn full_page_draw() -> Vec<Operation> {
        vec![
            op("q", vec![]),
            op(
                "cm",
                vec![
                    612.into(),
                    0.into(),
                    0.into(),
                    792.into(),
                    0.into(),
                    0.into(),
                ],
            ),
            op("Do", vec![Object::Name(b"Im0".to_vec())]),
            op("Q", vec![]),
        ]
    }

    #[test]
    fn a_plain_single_image_page_is_recognised() {
        let (document, page_id) = document_with(full_page_draw(), jpeg_image(32, 40));
        let stream = single_image_of_page(&document, page_id).unwrap();
        assert_eq!(
            stream.dict.get(b"Subtype").unwrap().as_name().unwrap(),
            b"Image"
        );
    }

    #[test]
    fn marked_content_and_clipping_do_not_disqualify_a_scan() {
        // Exactly the shape the Prokofiev Muzgiz and Barber editions use.
        let operations = vec![
            op(
                "BDC",
                vec![
                    Object::Name(b"Part".to_vec()),
                    Object::Dictionary(dictionary! {}),
                ],
            ),
            op("q", vec![]),
            op("re", vec![0.into(), 0.into(), 612.into(), 792.into()]),
            op("W", vec![]),
            op("n", vec![]),
            op("ri", vec![Object::Name(b"Perceptual".to_vec())]),
            op(
                "cm",
                vec![
                    612.into(),
                    0.into(),
                    0.into(),
                    792.into(),
                    0.into(),
                    0.into(),
                ],
            ),
            op("Do", vec![Object::Name(b"Im0".to_vec())]),
            op("Q", vec![]),
            op("EMC", vec![]),
        ];
        let (document, page_id) = document_with(operations, jpeg_image(32, 40));
        assert!(single_image_of_page(&document, page_id).is_ok());
    }

    #[test]
    fn a_page_with_text_is_refused() {
        let mut operations = full_page_draw();
        operations.push(op("BT", vec![]));
        let (document, page_id) = document_with(operations, jpeg_image(32, 40));
        let error = single_image_of_page(&document, page_id).unwrap_err();
        assert!(error.contains("BT"), "{error}");
    }

    #[test]
    fn a_page_that_strokes_or_fills_is_refused() {
        for painter in ["S", "f", "B", "sh"] {
            let mut operations = full_page_draw();
            operations.push(op(painter, vec![]));
            let (document, page_id) = document_with(operations, jpeg_image(32, 40));
            assert!(
                single_image_of_page(&document, page_id).is_err(),
                "operator {painter} should disqualify the page"
            );
        }
    }

    #[test]
    fn a_page_with_two_images_is_refused() {
        let mut operations = full_page_draw();
        operations.push(op("Do", vec![Object::Name(b"Im0".to_vec())]));
        let (document, page_id) = document_with(operations, jpeg_image(32, 40));
        assert!(single_image_of_page(&document, page_id)
            .unwrap_err()
            .contains("more than one"));
    }

    #[test]
    fn a_rotated_placement_is_refused() {
        // The real Griffes matrix: a 0.42° deskew rotation.
        let operations = vec![
            op("q", vec![]),
            op(
                "cm",
                vec![
                    Object::Real(731.4977),
                    Object::Real(-5.346649),
                    Object::Real(7.541092),
                    Object::Real(1031.7285),
                    Object::Real(-3.7593842),
                    Object::Real(2.6890717),
                ],
            ),
            op("Do", vec![Object::Name(b"Im0".to_vec())]),
            op("Q", vec![]),
        ];
        let (document, page_id) = document_with(operations, jpeg_image(32, 40));
        assert!(single_image_of_page(&document, page_id)
            .unwrap_err()
            .contains("rotated"));
    }

    #[test]
    fn a_negligible_skew_is_still_accepted() {
        let operations = vec![
            op("q", vec![]),
            op(
                "cm",
                vec![
                    Object::Real(612.0),
                    Object::Real(0.5),
                    Object::Real(0.5),
                    Object::Real(792.0),
                    0.into(),
                    0.into(),
                ],
            ),
            op("Do", vec![Object::Name(b"Im0".to_vec())]),
            op("Q", vec![]),
        ];
        let (document, page_id) = document_with(operations, jpeg_image(32, 40));
        assert!(single_image_of_page(&document, page_id).is_ok());
    }

    #[test]
    fn a_masked_image_is_refused() {
        let mut image = jpeg_image(32, 40);
        image.dict.set("SMask", Object::Null);
        let (document, page_id) = document_with(full_page_draw(), image);
        let stream = single_image_of_page(&document, page_id).unwrap();
        assert!(decode_image(&document, stream, 512)
            .unwrap_err()
            .contains("mask"));
    }

    #[test]
    fn a_stencil_mask_is_refused() {
        let mut image = jpeg_image(32, 40);
        image.dict.set("ImageMask", true);
        let (document, page_id) = document_with(full_page_draw(), image);
        let stream = single_image_of_page(&document, page_id).unwrap();
        assert!(decode_image(&document, stream, 512)
            .unwrap_err()
            .contains("stencil"));
    }

    #[test]
    fn an_unsupported_filter_is_refused_rather_than_guessed() {
        let mut image = jpeg_image(32, 40);
        image.dict.set("Filter", "JPXDecode");
        let (document, page_id) = document_with(full_page_draw(), image);
        let stream = single_image_of_page(&document, page_id).unwrap();
        assert!(decode_image(&document, stream, 512)
            .unwrap_err()
            .contains("JPXDecode"));
    }

    #[test]
    fn a_jpeg_page_decodes_at_the_requested_resolution() {
        let (document, page_id) = document_with(full_page_draw(), jpeg_image(256, 320));
        let stream = single_image_of_page(&document, page_id).unwrap();
        let decoded = decode_image(&document, stream, 160).unwrap();
        assert_eq!((decoded.width, decoded.height), (128, 160));
        assert_eq!(decoded.kind, Pixels::Gray);
        assert_eq!((decoded.source_width, decoded.source_height), (256, 320));
        assert_eq!(decoded.pixels.len(), 128 * 160);
        // The black band in the middle survived the downsample.
        let middle = decoded.pixels[80 * 128 + 64];
        assert!(middle < 200, "expected ink at the band, got {middle}");
    }

    #[test]
    fn dct_request_picks_the_cheap_scaled_decode() {
        // The real Barber page: 2876x3940 wanted at 2048 long edge. 1/2 gives
        // 1970 px — 4% under target, half the decode.
        assert_eq!(dct_request(2876, 3940, 2048), (1438, 1970));
        // A source barely above target still gets a full decode rather than a
        // blurry half one.
        assert_eq!(dct_request(2100, 2200, 2048), (2100, 2200));
        // A huge source can take the 1/4 step.
        assert_eq!(dct_request(8000, 10_000, 2048), (2000, 2500));
    }

    #[test]
    fn indirect_dictionary_values_are_resolved() {
        // The Griffes edition stores /Columns and /K as indirect references.
        let mut document = Document::with_version("1.5");
        let columns_id = document.add_object(Object::Integer(1728));
        let dictionary = dictionary! { "Columns" => Object::Reference(columns_id) };
        assert_eq!(integer(&document, &dictionary, b"Columns"), Some(1728));
    }

    #[test]
    fn resolve_survives_a_reference_cycle() {
        let mut document = Document::with_version("1.5");
        let id = document.new_object_id();
        document.objects.insert(id, Object::Reference(id));
        let object = Object::Reference(id);
        // Bounded chase: returns *something* instead of looping forever.
        let _ = resolve(&document, &object);
    }

    /// Real vault editions, if they are present. `#[ignore]`d because the files
    /// live in Christian's Obsidian vault, which CI does not have:
    ///
    /// ```text
    /// cargo test --release --lib score::scanned_page::tests::real -- --ignored --nocapture
    /// ```
    #[test]
    #[ignore = "needs Christian's vault"]
    fn real_vault_editions_take_the_fast_path() {
        let vault = std::path::PathBuf::from(std::env::var("HOME").unwrap())
            .join("Desktop/christian's universe/Piano Practice/Pieces");
        let cases: [(&str, u32, u32, &str); 4] = [
            (
                "Beethoven - Sonata Op.90 mvt1/score/Beethoven Op.90 - Henle Urtext (Wallner).pdf",
                5223,
                7291,
                "jbig2",
            ),
            (
                "Chamber Pieces Tanglewood/Christian_C_Barber_Pas_de_Deux_Primo.pdf",
                2876,
                3940,
                "jpeg",
            ),
            (
                "Prokofiev - Sonata No.1 Op.1/score/Prokofiev Op.1 - Muzgiz 1955 Collected Works urtext (IMSLP #153463).pdf",
                4940,
                6644,
                "jbig2",
            ),
            (
                "Chopin - Etude Op.10 No.4/score/Chopin_Etude_Op10_No4_Cortot.pdf",
                2549,
                3505,
                "ccitt",
            ),
        ];
        for (relative, width, height, kind) in cases {
            let path = vault.join(relative);
            if !path.exists() {
                println!("skipped (absent): {relative}");
                continue;
            }
            let start = std::time::Instant::now();
            let image = super::super::page_image::render_page_image(
                &path,
                1,
                super::super::page_image::SCREEN_TARGET_LONG_EDGE,
            )
            .unwrap_or_else(|e| panic!("{relative}: {e}"));
            assert_eq!(image.source_pixels, width as u64 * height as u64);
            assert!(image.width.max(image.height) <= 2048);
            assert!(image.jpeg.len() > 1024, "suspiciously small page image");
            println!(
                "{kind:>6}  {:>6.1} MP -> {}x{}  {:>7} bytes  {:?}",
                image.source_pixels as f64 / 1e6,
                image.width,
                image.height,
                image.jpeg.len(),
                start.elapsed()
            );
        }
    }
}
