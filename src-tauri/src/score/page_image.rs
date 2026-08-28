//! Screen-resolution page images for scanned editions.
//!
//! # Why this exists
//!
//! Nine of Christian's eleven real editions are scans, and a scanned page is one
//! enormous image XObject stretched over the whole page box:
//!
//! | edition                        | file    | page-1 image        |
//! |--------------------------------|---------|---------------------|
//! | Beethoven Op.90 Henle Urtext   | 1.0 MB  | 5223x7291 = 38.1 MP |
//! | Prokofiev Op.1 Muzgiz          | 1.1 MB  | 4940x6644 = 32.8 MP |
//! | Barber Pas de Deux             | 8.2 MB  | 2876x3940 = 11.3 MP |
//!
//! File size does not predict severity — the *smallest* file is the worst page.
//! What matters is pixels. Rendering such a page through the normal PDF pipeline
//! decodes every source pixel into a full-resolution bitmap (38.1 MP is 152 MB as
//! RGBA) and only then scales it down to the ~1.5 MP the screen can show.
//! ScoreView hard-caps its moving bitmap window at five pages, including the
//! tall/two-column viewport and disjoint-observer cases that need more than the
//! old paged reader's current-page ±1 topology.
//!
//! This module goes the other way round: find the single image the page is made
//! of, decode it *directly at screen resolution*, and hand back a small JPEG.
//! For DCT (JPEG) sources the decoder is asked for a 1/2, 1/4 or 1/8 scaled
//! decode, which never reconstructs the full-size coefficients at all. For the
//! bilevel sources (JBIG2, CCITT) the codecs stream pixels through a
//! [`Downsampler`] that only ever allocates the *target*-sized accumulator.
//!
//! Measured on the real vault files (release build, M2 Air), page 1 to encoded
//! JPEG: Henle 38.1 MP → 1467x2048 in ~210 ms; Barber 11.3 MP → 1495x2048 in
//! ~72 ms against ~2.8 s for the PDF.js raster of the same page.
//!
//! # It is allowed to say no
//!
//! Every function here refuses anything it is not certain about — a page with
//! text, two images, a rotated placement, an unsupported filter. A refusal is
//! not a failure: the caller falls back to the full PDF renderer, which is
//! already fast on vector pages (~46 ms for the Chopin Scherzo). Showing a wrong
//! or blank page would be much worse than being slow.

use std::path::Path;

/// Long edge (px) of the default screen bucket.
///
/// The score pane fills at most ~1000x800 CSS px on Christian's 13" M2 Air, and
/// `PdfPage` caps `devicePixelRatio` at 2, so a fit-page render asks for at most
/// ~1600 device px on the long edge. 2048 keeps a comfortable margin above that
/// — enough that a modest zoom still resamples down rather than up — while
/// staying far below the source.
pub const SCREEN_TARGET_LONG_EDGE: u32 = 2048;

/// Ceiling on any requested long edge, for the deep-zoom path.
///
/// Zooming past this asks for more pixels than a cached page image can honestly
/// provide, and the caller re-renders that one page through the full PDF
/// pipeline instead. 3200 is roughly a 2x zoom of the fit-page bucket at
/// `devicePixelRatio` 2.
pub const MAX_TARGET_LONG_EDGE: u32 = 3200;

/// Hard cap on the pixels of any page image this module will ever produce.
///
/// The number that matters on an 8 GB machine is not the JPEG on disk, it is the
/// bitmap the renderer holds: `w * h * 4` bytes. 8 MP is 32 MB, so ScoreView's
/// hard five-page resident window costs at most 160 MB decimal (152.6 MiB) —
/// still close to one full-resolution 38.1 MP Henle page instead of five of
/// them (~762 MB). This is specifically
/// the steady-state fast-path page-canvas budget; browser decode/blit scratch
/// surfaces and the deep-zoom PDF.js fallback are separate allocations. The cap
/// sits about 2x above what
/// [`SCREEN_TARGET_LONG_EDGE`] needs for a normal page, so it never binds at fit
/// zoom; it exists to stop an unusually shaped page (a very tall or very square
/// scan) from turning a long-edge request into a huge bitmap.
pub const MAX_TARGET_MEGAPIXELS: f64 = 8.0;

/// Frontend mirror: `ScoreView`'s explicit `.slice(0, 5)` hard cap.
///
/// Keeping this named in the native test makes the 160 MB calculation auditable
/// instead of silently assuming the old paged-viewer topology.
#[cfg(test)]
const SCORE_VIEW_RESIDENT_PAGE_CANVASES: u64 = 5;

/// JPEG quality for cached page images. High enough that engraving edges stay
/// clean after the box filter has already done the anti-aliasing, low enough
/// that a page stays a few hundred KB.
pub const PAGE_JPEG_QUALITY: u8 = 78;

/// The buckets a caller may request. Quantizing keeps the on-disk cache from
/// filling with near-identical sizes as the window is resized by a few pixels.
pub const TARGET_BUCKETS: [u32; 6] = [1024, 1280, 1536, 2048, 2560, 3200];

/// Smallest bucket that covers `needed_long_edge`, saturating at
/// [`MAX_TARGET_LONG_EDGE`].
///
/// A request of 0 (or anything below the smallest bucket) means the caller had
/// no viewport measurement to offer, so it gets the screen default rather than a
/// useless thumbnail. Saturating rather than refusing is deliberate: a caller
/// that zooms past the ceiling still gets the best image available, sees that it
/// is short of what it asked for, and can decide to re-render that one page
/// through the full PDF pipeline.
pub fn bucket_for(needed_long_edge: u32) -> u32 {
    if needed_long_edge == 0 {
        return SCREEN_TARGET_LONG_EDGE;
    }
    for bucket in TARGET_BUCKETS {
        if bucket >= needed_long_edge {
            return bucket;
        }
    }
    MAX_TARGET_LONG_EDGE
}

/// Interleaved sample layout of a decoded page.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Pixels {
    Gray,
    Rgb,
}

impl Pixels {
    pub fn channels(self) -> usize {
        match self {
            Pixels::Gray => 1,
            Pixels::Rgb => 3,
        }
    }
}

/// One page, decoded and re-encoded at screen resolution.
#[derive(Debug, Clone)]
pub struct PageImage {
    pub jpeg: Vec<u8>,
    pub width: u32,
    pub height: u32,
    /// Pixels in the *source* image, kept for logging/benchmarks.
    pub source_pixels: u64,
}

/// Decode page `page` of `pdf` straight to a screen-resolution JPEG.
///
/// `Err` means "this page is not a single-image scan we can serve" (or the file
/// is not parseable); callers treat that as a cache miss and fall back.
pub fn render_page_image(
    pdf: &Path,
    page: u32,
    requested_long_edge: u32,
) -> Result<PageImage, String> {
    let document = lopdf::Document::load(pdf).map_err(|e| format!("parse PDF: {e}"))?;
    render_page_image_from(&document, page, requested_long_edge)
}

/// The same, against an already-parsed document (the test/bench seam).
pub fn render_page_image_from(
    document: &lopdf::Document,
    page: u32,
    requested_long_edge: u32,
) -> Result<PageImage, String> {
    let pages = document.get_pages();
    let page_id = *pages
        .get(&page)
        .ok_or_else(|| format!("page {page} is outside this edition"))?;
    let stream = super::scanned_page::single_image_of_page(document, page_id)?;
    let decoded = super::scanned_page::decode_image(document, stream, requested_long_edge.max(1))?;
    let jpeg = encode_jpeg(
        &decoded.pixels,
        decoded.width,
        decoded.height,
        decoded.kind,
        PAGE_JPEG_QUALITY,
    )?;
    Ok(PageImage {
        jpeg,
        width: decoded.width,
        height: decoded.height,
        source_pixels: decoded.source_width as u64 * decoded.source_height as u64,
    })
}

/// Target bitmap size for a source, honouring both the long-edge request and
/// [`MAX_TARGET_MEGAPIXELS`]. Never upscales.
pub fn target_size(source_width: u32, source_height: u32, requested_long_edge: u32) -> (u32, u32) {
    let long_edge = requested_long_edge.clamp(64, MAX_TARGET_LONG_EDGE);
    let width = source_width.max(1) as f64;
    let height = source_height.max(1) as f64;
    let by_edge = (long_edge as f64 / width.max(height)).min(1.0);
    let by_pixels = (MAX_TARGET_MEGAPIXELS * 1e6 / (width * height))
        .sqrt()
        .min(1.0);
    let scale = by_edge.min(by_pixels);
    (
        ((width * scale).round() as u32).max(1),
        ((height * scale).round() as u32).max(1),
    )
}

/// Streaming box-filter downsampler.
///
/// Source pixels arrive in raster order and are accumulated straight into a
/// target-sized buffer, so decoding a 38 MP bilevel page costs ~12 MB (the
/// 3 MP accumulator) instead of 38 MB for the source bitmap or 152 MB for its
/// RGBA expansion. Averaging is what keeps thin engraving lines visible: nearest
/// -neighbour sampling of a 1-bit scan drops whole staff lines.
pub struct Downsampler {
    source_width: u32,
    source_height: u32,
    target_width: u32,
    target_height: u32,
    channels: usize,
    sums: Vec<u32>,
    column_of: Vec<u32>,
    column_count: Vec<u32>,
    row_count: Vec<u32>,
    x: u32,
    y: u32,
}

impl Downsampler {
    pub fn new(
        source_width: u32,
        source_height: u32,
        target_width: u32,
        target_height: u32,
        kind: Pixels,
    ) -> Self {
        let source_width = source_width.max(1);
        let source_height = source_height.max(1);
        let target_width = target_width.clamp(1, source_width);
        let target_height = target_height.clamp(1, source_height);
        let column_of: Vec<u32> = (0..source_width)
            .map(|x| {
                (((x as u64 * target_width as u64) / source_width as u64) as u32)
                    .min(target_width - 1)
            })
            .collect();
        let mut column_count = vec![0u32; target_width as usize];
        for column in &column_of {
            column_count[*column as usize] += 1;
        }
        let mut row_count = vec![0u32; target_height as usize];
        for y in 0..source_height {
            row_count[row_index(y, source_height, target_height) as usize] += 1;
        }
        Self {
            source_width,
            source_height,
            target_width,
            target_height,
            channels: kind.channels(),
            sums: vec![0u32; target_width as usize * target_height as usize * kind.channels()],
            column_of,
            column_count,
            row_count,
            x: 0,
            y: 0,
        }
    }

    /// Push one grayscale source pixel.
    #[inline]
    pub fn push_gray(&mut self, value: u8) {
        if self.y >= self.source_height {
            return;
        }
        let target_x = self.column_of[self.x as usize] as usize;
        let target_y = row_index(self.y, self.source_height, self.target_height) as usize;
        self.sums[target_y * self.target_width as usize + target_x] += value as u32;
        self.advance(1);
    }

    /// Push `count` identical grayscale source pixels.
    ///
    /// The bilevel codecs hand us long same-colour runs, and collapsing a run
    /// into one add per *target* column is what makes a 38 MP page affordable.
    #[inline]
    pub fn push_gray_run(&mut self, value: u8, count: u32) {
        let mut remaining = count;
        while remaining > 0 {
            if self.y >= self.source_height {
                return;
            }
            let take = remaining.min(self.source_width - self.x);
            let target_y = row_index(self.y, self.source_height, self.target_height) as usize;
            let base = target_y * self.target_width as usize;
            let start = self.x as usize;
            let end = start + take as usize;
            let mut index = start;
            while index < end {
                let target_x = self.column_of[index] as usize;
                let mut run_end = index;
                while run_end < end && self.column_of[run_end] as usize == target_x {
                    run_end += 1;
                }
                self.sums[base + target_x] += value as u32 * (run_end - index) as u32;
                index = run_end;
            }
            self.advance(take);
            remaining -= take;
        }
    }

    #[inline]
    fn advance(&mut self, count: u32) {
        self.x += count;
        if self.x >= self.source_width {
            self.x = 0;
            self.y += 1;
        }
    }

    /// End the current source row early. Codecs signal end-of-line explicitly,
    /// and a truncated row must not slide every later pixel one column left.
    pub fn end_row(&mut self) {
        if self.x != 0 {
            self.x = 0;
            self.y += 1;
        }
    }

    /// Average each target cell and return the interleaved bitmap.
    pub fn finish(self) -> Vec<u8> {
        let mut out =
            vec![0u8; self.target_width as usize * self.target_height as usize * self.channels];
        for target_y in 0..self.target_height as usize {
            let rows = self.row_count[target_y].max(1) as u64;
            for target_x in 0..self.target_width as usize {
                let denominator = rows * self.column_count[target_x].max(1) as u64;
                for channel in 0..self.channels {
                    let index = (target_y * self.target_width as usize + target_x) * self.channels
                        + channel;
                    out[index] =
                        ((self.sums[index] as u64 + denominator / 2) / denominator).min(255) as u8;
                }
            }
        }
        out
    }
}

#[inline]
fn row_index(y: u32, source_height: u32, target_height: u32) -> u32 {
    (((y as u64 * target_height as u64) / source_height.max(1) as u64) as u32)
        .min(target_height.saturating_sub(1))
}

/// Box-downsample an already-decoded interleaved buffer (the DCT path, whose
/// decoder hands back a whole — already much smaller — bitmap).
pub fn downsample_buffer(
    source: &[u8],
    source_width: u32,
    source_height: u32,
    target_width: u32,
    target_height: u32,
    kind: Pixels,
) -> Vec<u8> {
    if source_width == target_width && source_height == target_height {
        return source.to_vec();
    }
    let channels = kind.channels();
    let mut down = Downsampler::new(
        source_width,
        source_height,
        target_width,
        target_height,
        kind,
    );
    if channels == 1 {
        for value in source
            .iter()
            .take(source_width as usize * source_height as usize)
        {
            down.push_gray(*value);
        }
        return down.finish();
    }
    // RGB: accumulate the three planes by running the same geometry per channel.
    let mut planes: Vec<Vec<u8>> = Vec::with_capacity(channels);
    for channel in 0..channels {
        let mut plane = Downsampler::new(
            source_width,
            source_height,
            target_width,
            target_height,
            Pixels::Gray,
        );
        let mut index = channel;
        let limit = source_width as usize * source_height as usize * channels;
        while index < limit {
            plane.push_gray(source[index]);
            index += channels;
        }
        planes.push(plane.finish());
    }
    let mut out = vec![0u8; planes[0].len() * channels];
    for (pixel, chunk) in out.chunks_exact_mut(channels).enumerate() {
        for (channel, value) in chunk.iter_mut().enumerate() {
            *value = planes[channel][pixel];
        }
    }
    out
}

/// Encode an interleaved bitmap as baseline JPEG.
pub fn encode_jpeg(
    pixels: &[u8],
    width: u32,
    height: u32,
    kind: Pixels,
    quality: u8,
) -> Result<Vec<u8>, String> {
    let expected = width as usize * height as usize * kind.channels();
    if width == 0 || height == 0 || pixels.len() != expected {
        return Err(format!(
            "page bitmap is {} bytes, expected {expected} for {width}x{height}",
            pixels.len()
        ));
    }
    if width > u16::MAX as u32 || height > u16::MAX as u32 {
        return Err("page bitmap exceeds the JPEG dimension limit".into());
    }
    let mut out = Vec::new();
    let mut encoder = jpeg_encoder::Encoder::new(&mut out, quality);
    encoder.set_progressive(false);
    if kind == Pixels::Rgb {
        // Chroma subsampling: a scan's ink is luminance, and 4:2:0 roughly halves
        // the cached bytes without touching the engraving's sharpness.
        encoder.set_sampling_factor(jpeg_encoder::SamplingFactor::R_4_2_0);
    }
    let color = match kind {
        Pixels::Gray => jpeg_encoder::ColorType::Luma,
        Pixels::Rgb => jpeg_encoder::ColorType::Rgb,
    };
    encoder
        .encode(pixels, width as u16, height as u16, color)
        .map_err(|e| format!("encode page image: {e}"))?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_megapixel_cap_is_the_documented_memory_budget() {
        // The cap is stated as a per-page RGBA budget; keep the arithmetic honest
        // so a future edit cannot quietly raise it.
        let bytes_per_page = MAX_TARGET_MEGAPIXELS * 1e6 * 4.0;
        assert_eq!(bytes_per_page as u64, 32_000_000);
        let resident_bytes = bytes_per_page * SCORE_VIEW_RESIDENT_PAGE_CANVASES as f64;
        assert_eq!(resident_bytes as u64, 160_000_000);
    }

    #[test]
    fn a_38_megapixel_page_never_becomes_a_38_megapixel_bitmap() {
        // The real Beethoven Op.90 Henle Urtext page 1.
        let (width, height) = target_size(5223, 7291, SCREEN_TARGET_LONG_EDGE);
        assert_eq!((width, height), (1467, 2048));
        let megapixels = width as f64 * height as f64 / 1e6;
        assert!(megapixels < MAX_TARGET_MEGAPIXELS, "{megapixels} MP");
        assert!(megapixels < 38.1 / 12.0, "expected >12x fewer pixels");
    }

    #[test]
    fn target_size_honours_the_megapixel_cap_before_the_long_edge() {
        // A nearly square 40 MP scan: the long edge alone would allow
        // 3200x3200 = 10.2 MP, so the pixel cap has to bind.
        let (width, height) = target_size(6400, 6400, MAX_TARGET_LONG_EDGE);
        let megapixels = width as f64 * height as f64 / 1e6;
        assert!(
            megapixels <= MAX_TARGET_MEGAPIXELS + 0.01,
            "{megapixels} MP"
        );
        assert!(width < MAX_TARGET_LONG_EDGE);
    }

    #[test]
    fn target_size_never_upscales_a_small_source() {
        assert_eq!(target_size(600, 800, 2048), (600, 800));
        assert_eq!(target_size(1, 1, 2048), (1, 1));
    }

    #[test]
    fn target_size_clamps_a_request_past_the_ceiling() {
        let (width, height) = target_size(10_000, 14_000, 99_999);
        assert!(width.max(height) <= MAX_TARGET_LONG_EDGE);
        assert!(width as f64 * height as f64 <= MAX_TARGET_MEGAPIXELS * 1e6 + 1.0);
    }

    #[test]
    fn buckets_are_the_smallest_that_covers_the_need() {
        assert_eq!(bucket_for(1), 1024);
        assert_eq!(bucket_for(1024), 1024);
        assert_eq!(bucket_for(1025), 1280);
        assert_eq!(bucket_for(1600), 2048);
        assert_eq!(bucket_for(3200), 3200);
        // Past the ceiling: serve the best available rather than nothing.
        assert_eq!(bucket_for(9000), MAX_TARGET_LONG_EDGE);
        // No measurement at all: the screen default, not a thumbnail.
        assert_eq!(bucket_for(0), SCREEN_TARGET_LONG_EDGE);
    }

    #[test]
    fn downsampling_averages_rather_than_dropping_pixels() {
        // A 1-px black line on white in a 4x4 source, halved. Nearest-neighbour
        // would lose the line entirely in one of the two output rows; the box
        // filter must darken both cells it falls into.
        let mut down = Downsampler::new(4, 4, 2, 2, Pixels::Gray);
        for y in 0..4 {
            for _ in 0..4 {
                down.push_gray(if y == 1 { 0 } else { 255 });
            }
        }
        let out = down.finish();
        assert_eq!(out, vec![128, 128, 255, 255]);
    }

    #[test]
    fn run_pushes_match_pixel_pushes_exactly() {
        let mut single = Downsampler::new(8, 4, 3, 2, Pixels::Gray);
        let mut runs = Downsampler::new(8, 4, 3, 2, Pixels::Gray);
        for y in 0..4u32 {
            for x in 0..8u32 {
                single.push_gray(if (x + y) % 3 == 0 { 0 } else { 255 });
            }
        }
        for y in 0..4u32 {
            let mut x = 0u32;
            while x < 8 {
                let value = if (x + y).is_multiple_of(3) { 0 } else { 255 };
                let mut run = 1;
                while x + run < 8 && (x + run + y).is_multiple_of(3) == (value == 0) {
                    run += 1;
                }
                runs.push_gray_run(value, run);
                x += run;
            }
        }
        assert_eq!(single.finish(), runs.finish());
    }

    #[test]
    fn a_run_spanning_rows_wraps_correctly() {
        let mut down = Downsampler::new(4, 2, 2, 1, Pixels::Gray);
        down.push_gray_run(255, 8);
        assert_eq!(down.finish(), vec![255, 255]);
    }

    #[test]
    fn overlong_pushes_are_ignored_rather_than_panicking() {
        let mut down = Downsampler::new(2, 2, 1, 1, Pixels::Gray);
        down.push_gray_run(255, 1_000);
        for _ in 0..1_000 {
            down.push_gray(0);
        }
        assert_eq!(down.finish(), vec![255]);
    }

    #[test]
    fn end_row_realigns_a_truncated_source_row() {
        // Row 0 only delivers 2 of its 4 pixels. Without end_row the next row's
        // pixels would shift left and the image would shear.
        let mut down = Downsampler::new(4, 2, 4, 2, Pixels::Gray);
        down.push_gray(10);
        down.push_gray(20);
        down.end_row();
        for value in [40u8, 50, 60, 70] {
            down.push_gray(value);
        }
        assert_eq!(down.finish(), vec![10, 20, 0, 0, 40, 50, 60, 70]);
    }

    #[test]
    fn downsample_buffer_keeps_rgb_channels_separate() {
        // 2x1 source: pure red then pure blue, averaged into one pixel.
        let source = [255u8, 0, 0, 0, 0, 255];
        let out = downsample_buffer(&source, 2, 1, 1, 1, Pixels::Rgb);
        assert_eq!(out, vec![128, 0, 128]);
    }

    #[test]
    fn downsample_buffer_is_identity_at_the_same_size() {
        let source = [1u8, 2, 3, 4];
        assert_eq!(
            downsample_buffer(&source, 2, 2, 2, 2, Pixels::Gray),
            source.to_vec()
        );
    }

    #[test]
    fn encoded_jpeg_round_trips_to_the_same_size_and_content() {
        let mut pixels = vec![255u8; 64 * 48];
        for y in 20..24 {
            for x in 0..64 {
                pixels[y * 64 + x] = 0;
            }
        }
        let jpeg = encode_jpeg(&pixels, 64, 48, Pixels::Gray, PAGE_JPEG_QUALITY).unwrap();
        assert_eq!(&jpeg[..2], &[0xFF, 0xD8], "not a JPEG");
        let mut decoder = jpeg_decoder::Decoder::new(std::io::Cursor::new(&jpeg));
        let decoded = decoder.decode().unwrap();
        let info = decoder.info().unwrap();
        assert_eq!((info.width, info.height), (64, 48));
        // The black band survived, the white background stayed white.
        assert!(decoded[21 * 64 + 32] < 40);
        assert!(decoded[32] > 215);
    }

    #[test]
    fn encode_rejects_a_bitmap_that_does_not_match_its_dimensions() {
        assert!(encode_jpeg(&[0u8; 10], 4, 4, Pixels::Gray, 80).is_err());
        assert!(encode_jpeg(&[], 0, 0, Pixels::Gray, 80).is_err());
    }
}
