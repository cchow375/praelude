//! Bounded, read-only MusicXML facts for one selected measure range.
//!
//! The parser intentionally extracts notated facts rather than attempting a
//! musical diagnosis. It never resolves the external DTD declaration found in
//! the real KernScores files, never follows a frontend path, and never treats
//! score text as instructions.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::fs::{self, File};
use std::io::BufReader;
use std::path::Path;

use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;
use serde::Serialize;

use crate::store::model::PieceDetail;

const MAX_XML_BYTES: u64 = 16 * 1024 * 1024;
const MAX_XML_EVENTS: usize = 1_000_000;
const MAX_XML_DEPTH: usize = 128;
const MAX_XML_TEXT_CHARS: usize = 256;
const MAX_PARTS: u32 = 64;
const MAX_MEASURES: u32 = 24;
const MAX_NOTE_TOKENS_PER_MEASURE: usize = 16;
const MAX_FACT_VALUES_PER_FIELD: usize = 16;
const MAX_DIRECTION_CHARS: usize = 180;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ScoreContextStatus {
    NotRequested,
    Ready,
    Missing,
    Unsupported,
    InvalidRange,
    Unavailable,
    Invalid,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ScoreMeasureFact {
    pub number: u32,
    pub key_signatures: Vec<String>,
    pub time_signatures: Vec<String>,
    pub tempos: Vec<String>,
    pub dynamics: Vec<String>,
    pub directions: Vec<String>,
    pub voices: Vec<String>,
    pub staves: Vec<String>,
    pub note_count: u32,
    pub rest_count: u32,
    pub chord_tones: u32,
    pub pitches_and_rhythms: Vec<String>,
    pub ties: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ScoreContext {
    pub status: ScoreContextStatus,
    pub requested_range: Option<[u32; 2]>,
    pub measures: Vec<ScoreMeasureFact>,
    pub warnings: Vec<String>,
}

impl ScoreContext {
    pub fn not_requested() -> Self {
        Self {
            status: ScoreContextStatus::NotRequested,
            requested_range: None,
            measures: Vec::new(),
            warnings: Vec::new(),
        }
    }

    fn status(
        status: ScoreContextStatus,
        range: Option<(u32, u32)>,
        warning: impl Into<String>,
    ) -> Self {
        Self {
            status,
            requested_range: range.map(|(start, end)| [start, end]),
            measures: Vec::new(),
            warnings: vec![warning.into()],
        }
    }
}

/// Parse the score path already owned by the canonical piece row. A caller can
/// request no range, in which case no filesystem access occurs.
pub fn summarize(piece: &PieceDetail, range: Option<(u32, u32)>) -> ScoreContext {
    let Some((start, end)) = range else {
        return ScoreContext::not_requested();
    };
    if end < start || end.saturating_sub(start) >= MAX_MEASURES {
        return ScoreContext::status(
            ScoreContextStatus::InvalidRange,
            Some((start, end)),
            format!("MusicXML context supports at most {MAX_MEASURES} measures per question"),
        );
    }
    let Some(raw_path) = piece.xml_path.as_deref() else {
        return ScoreContext::status(
            ScoreContextStatus::Missing,
            Some((start, end)),
            "This piece has no MusicXML file; advice is grounded in the practice record and library only",
        );
    };
    let path = Path::new(raw_path);
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if extension.eq_ignore_ascii_case("mxl") {
        return ScoreContext::status(
            ScoreContextStatus::Unsupported,
            Some((start, end)),
            "Compressed .mxl score analysis is not supported yet",
        );
    }
    if !extension.eq_ignore_ascii_case("musicxml") && !extension.eq_ignore_ascii_case("xml") {
        return ScoreContext::status(
            ScoreContextStatus::Unsupported,
            Some((start, end)),
            "The selected score is not a supported .musicxml file",
        );
    }

    let root = match Path::new(&piece.folder_path).canonicalize() {
        Ok(root) if root.is_dir() => root,
        _ => {
            return ScoreContext::status(
                ScoreContextStatus::Unavailable,
                Some((start, end)),
                "The piece folder is unavailable",
            )
        }
    };
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => metadata,
        _ => {
            return ScoreContext::status(
                ScoreContextStatus::Unavailable,
                Some((start, end)),
                "The MusicXML file is missing, unreadable, or a symbolic link",
            )
        }
    };
    if metadata.len() == 0 || metadata.len() > MAX_XML_BYTES {
        return ScoreContext::status(
            ScoreContextStatus::Unavailable,
            Some((start, end)),
            "The MusicXML file is empty or exceeds the 16 MB analysis limit",
        );
    }
    let canonical = match path.canonicalize() {
        Ok(canonical) if canonical.starts_with(&root) => canonical,
        _ => {
            return ScoreContext::status(
                ScoreContextStatus::Unavailable,
                Some((start, end)),
                "The MusicXML file is outside its piece folder",
            )
        }
    };
    if !has_musicxml_root(&canonical) {
        return ScoreContext::status(
            ScoreContextStatus::Unsupported,
            Some((start, end)),
            "The selected XML file is not a MusicXML score-partwise or score-timewise document",
        );
    }
    let file = match File::open(canonical) {
        Ok(file) => file,
        Err(_) => {
            return ScoreContext::status(
                ScoreContextStatus::Unavailable,
                Some((start, end)),
                "The MusicXML file could not be opened",
            )
        }
    };
    match parse(BufReader::new(file), start, end, MAX_XML_EVENTS) {
        Ok(mut measures) => {
            let mut warnings = vec![
                "MusicXML facts describe the encoding, not how the pianist played".into(),
                "The MusicXML edition may differ from the open PDF; verify notes and measure numbers against the score".into(),
            ];
            if measures.is_empty() {
                warnings.push("No numeric measures in the requested range were found".into());
            }
            ScoreContext {
                status: ScoreContextStatus::Ready,
                requested_range: Some([start, end]),
                measures: std::mem::take(&mut measures),
                warnings,
            }
        }
        Err(_) => ScoreContext::status(
            ScoreContextStatus::Invalid,
            Some((start, end)),
            "The MusicXML file could not be parsed safely",
        ),
    }
}

/// Validate the first real root element without loading the score or resolving
/// its DOCTYPE. This is especially important for the deliberately narrow
/// plain-`.xml` fallback accepted by the vault scanner.
fn has_musicxml_root(path: &Path) -> bool {
    let Ok(file) = File::open(path) else {
        return false;
    };
    let mut reader = Reader::from_reader(BufReader::new(file));
    reader.config_mut().trim_text(true);
    let mut buffer = Vec::new();
    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(event)) | Ok(Event::Empty(event)) => {
                let name = event.local_name();
                return name.as_ref() == b"score-partwise" || name.as_ref() == b"score-timewise";
            }
            Ok(Event::DocType(_) | Event::Decl(_) | Event::PI(_) | Event::Comment(_)) => {}
            Ok(Event::Text(text)) if text.iter().all(|byte| byte.is_ascii_whitespace()) => {}
            Ok(Event::Eof) | Err(_) => return false,
            _ => return false,
        }
        buffer.clear();
    }
}

#[derive(Debug, Default, Clone)]
struct PartState {
    key: Option<String>,
    time: Option<String>,
    divisions: Option<u32>,
    beats: Option<String>,
    beat_type: Option<String>,
}

#[derive(Debug, Default)]
struct MeasureAccumulator {
    number: u32,
    key_signatures: BTreeSet<String>,
    time_signatures: BTreeSet<String>,
    tempos: BTreeSet<String>,
    dynamics: BTreeSet<String>,
    directions: BTreeSet<String>,
    voices: BTreeSet<String>,
    staves: BTreeSet<String>,
    note_count: u32,
    rest_count: u32,
    chord_tones: u32,
    pitches_and_rhythms: Vec<String>,
    ties: BTreeSet<String>,
}

impl MeasureAccumulator {
    fn finish(self) -> ScoreMeasureFact {
        ScoreMeasureFact {
            number: self.number,
            key_signatures: self.key_signatures.into_iter().collect(),
            time_signatures: self.time_signatures.into_iter().collect(),
            tempos: self.tempos.into_iter().collect(),
            dynamics: self.dynamics.into_iter().collect(),
            directions: self.directions.into_iter().collect(),
            voices: self.voices.into_iter().collect(),
            staves: self.staves.into_iter().collect(),
            note_count: self.note_count,
            rest_count: self.rest_count,
            chord_tones: self.chord_tones,
            pitches_and_rhythms: self.pitches_and_rhythms,
            ties: self.ties.into_iter().collect(),
        }
    }
}

#[derive(Debug, Default)]
struct NoteAccumulator {
    step: Option<String>,
    alter: Option<i32>,
    octave: Option<String>,
    duration: Option<String>,
    note_type: Option<String>,
    voice: Option<String>,
    staff: Option<String>,
    rest: bool,
    chord: bool,
    dots: u8,
    ties: BTreeSet<String>,
}

fn parse(
    source: impl std::io::BufRead,
    start_measure: u32,
    end_measure: u32,
    max_events: usize,
) -> Result<Vec<ScoreMeasureFact>, ()> {
    let mut reader = Reader::from_reader(source);
    reader.config_mut().trim_text(true);
    reader.config_mut().check_end_names = true;
    let mut buffer = Vec::new();
    let mut stack = Vec::<String>::new();
    let mut part_ordinal = 0_u32;
    let mut part_id = String::new();
    let mut seen_parts = HashSet::<String>::new();
    let mut part_states = HashMap::<String, PartState>::new();
    let mut current_measure = None::<u32>;
    let mut note = None::<NoteAccumulator>;
    let mut measures = BTreeMap::<u32, MeasureAccumulator>::new();
    let mut event_count = 0_usize;

    loop {
        let event = reader.read_event_into(&mut buffer).map_err(|_| ())?;
        event_count = event_count.saturating_add(1);
        if event_count > max_events {
            return Err(());
        }
        match event {
            Event::Start(event) => {
                if stack.len() >= MAX_XML_DEPTH {
                    return Err(());
                }
                let name = local_name(&event);
                if name == "part" {
                    part_id = attribute(&event, b"id", reader.decoder()).unwrap_or_else(|| {
                        part_ordinal += 1;
                        format!("part-{part_ordinal}")
                    });
                    if !seen_parts.contains(&part_id) && seen_parts.len() >= MAX_PARTS as usize {
                        return Err(());
                    }
                    seen_parts.insert(part_id.clone());
                    part_states.entry(part_id.clone()).or_default();
                } else if name == "measure" {
                    current_measure = attribute(&event, b"number", reader.decoder())
                        .and_then(|value| numeric_measure(&value));
                    if let Some(number) = current_measure
                        .filter(|number| (start_measure..=end_measure).contains(number))
                    {
                        let measure =
                            measures
                                .entry(number)
                                .or_insert_with(|| MeasureAccumulator {
                                    number,
                                    ..Default::default()
                                });
                        if let Some(state) = part_states.get(&part_id) {
                            if let Some(key) = &state.key {
                                insert_bounded(&mut measure.key_signatures, key.clone());
                            }
                            if let Some(time) = &state.time {
                                insert_bounded(&mut measure.time_signatures, time.clone());
                            }
                        }
                    }
                } else if name == "note" {
                    note = Some(NoteAccumulator::default());
                }
                handle_marker(
                    &name,
                    &event,
                    &stack,
                    reader.decoder(),
                    selected_measure(current_measure, start_measure, end_measure),
                    &mut note,
                    &mut measures,
                );
                stack.push(name);
            }
            Event::Empty(event) => {
                let name = local_name(&event);
                handle_marker(
                    &name,
                    &event,
                    &stack,
                    reader.decoder(),
                    selected_measure(current_measure, start_measure, end_measure),
                    &mut note,
                    &mut measures,
                );
            }
            Event::Text(text) => {
                let decoded = text.xml10_content().map_err(|_| ())?;
                let value = quick_xml::escape::unescape(&decoded)
                    .map_err(|_| ())?
                    .trim()
                    .chars()
                    .take(MAX_XML_TEXT_CHARS)
                    .collect::<String>();
                if !value.is_empty() {
                    handle_text(
                        stack.last().map(String::as_str).unwrap_or_default(),
                        &value,
                        selected_measure(current_measure, start_measure, end_measure),
                        &part_id,
                        &mut part_states,
                        &mut note,
                        &mut measures,
                    );
                }
            }
            Event::End(event) => {
                let name = String::from_utf8_lossy(event.local_name().as_ref()).into_owned();
                if name == "note" {
                    if let (Some(number), Some(note)) = (
                        selected_measure(current_measure, start_measure, end_measure),
                        note.take(),
                    ) {
                        add_note(&part_id, number, note, &mut measures);
                    } else {
                        note = None;
                    }
                } else if name == "time" {
                    let state = part_states.entry(part_id.clone()).or_default();
                    if let (Some(beats), Some(beat_type)) =
                        (state.beats.take(), state.beat_type.take())
                    {
                        let time = format!("{beats}/{beat_type}");
                        state.time = Some(time.clone());
                        if let Some(number) =
                            selected_measure(current_measure, start_measure, end_measure)
                        {
                            insert_bounded(
                                &mut measures.entry(number).or_default().time_signatures,
                                time,
                            );
                        }
                    }
                } else if name == "measure" {
                    current_measure = None;
                }
                stack.pop();
            }
            // quick-xml reports the declaration but never resolves or fetches
            // its external system identifier. Ignoring it is intentional.
            Event::DocType(_) | Event::Decl(_) | Event::PI(_) | Event::Comment(_) => {}
            Event::CData(text) => {
                let value = text
                    .decode()
                    .map_err(|_| ())?
                    .chars()
                    .take(MAX_XML_TEXT_CHARS)
                    .collect::<String>();
                if let Some(number) = selected_measure(current_measure, start_measure, end_measure)
                {
                    add_direction(number, &value, &mut measures);
                }
            }
            Event::GeneralRef(_) => {}
            Event::Eof => break,
        }
        buffer.clear();
    }
    Ok(measures
        .into_values()
        .map(MeasureAccumulator::finish)
        .collect())
}

fn handle_marker(
    name: &str,
    event: &BytesStart<'_>,
    stack: &[String],
    decoder: quick_xml::encoding::Decoder,
    measure_number: Option<u32>,
    note: &mut Option<NoteAccumulator>,
    measures: &mut BTreeMap<u32, MeasureAccumulator>,
) {
    match name {
        "rest" => {
            if let Some(note) = note {
                note.rest = true;
            }
        }
        "chord" => {
            if let Some(note) = note {
                note.chord = true;
            }
        }
        "dot" => {
            if let Some(note) = note {
                note.dots = note.dots.saturating_add(1);
            }
        }
        "tie" | "tied" => {
            if let Some(kind) = attribute(event, b"type", decoder) {
                if let Some(note) = note {
                    insert_bounded(&mut note.ties, kind);
                }
            }
        }
        "sound" => {
            if let (Some(number), Some(tempo)) =
                (measure_number, attribute(event, b"tempo", decoder))
            {
                insert_bounded(
                    &mut measures.entry(number).or_default().tempos,
                    format!("quarter ≈ {tempo} BPM"),
                );
            }
        }
        _ if stack.last().is_some_and(|parent| parent == "dynamics") => {
            if let Some(number) = measure_number {
                insert_bounded(
                    &mut measures.entry(number).or_default().dynamics,
                    name.to_string(),
                );
            }
        }
        _ => {}
    }
}

fn handle_text(
    tag: &str,
    value: &str,
    measure_number: Option<u32>,
    part_id: &str,
    part_states: &mut HashMap<String, PartState>,
    note: &mut Option<NoteAccumulator>,
    measures: &mut BTreeMap<u32, MeasureAccumulator>,
) {
    if let Some(note) = note {
        match tag {
            "step" => note.step = Some(value.to_string()),
            "alter" => note.alter = value.parse().ok(),
            "octave" => note.octave = Some(value.to_string()),
            "duration" => note.duration = Some(value.to_string()),
            "type" => note.note_type = Some(value.to_string()),
            "voice" => note.voice = Some(value.to_string()),
            "staff" => note.staff = Some(value.to_string()),
            _ => {}
        }
    }
    let state = part_states.entry(part_id.to_string()).or_default();
    match tag {
        "divisions" => state.divisions = value.parse().ok(),
        "fifths" => {
            let key = format!("{part_id}: {value} fifths");
            state.key = Some(key.clone());
            if let Some(number) = measure_number {
                insert_bounded(&mut measures.entry(number).or_default().key_signatures, key);
            }
        }
        "beats" => state.beats = Some(value.to_string()),
        "beat-type" => state.beat_type = Some(value.to_string()),
        "per-minute" => {
            if let Some(number) = measure_number {
                insert_bounded(
                    &mut measures.entry(number).or_default().tempos,
                    format!("metronome marking {value} BPM"),
                );
            }
        }
        "words" | "rehearsal" => {
            if let Some(number) = measure_number {
                add_direction(number, value, measures);
            }
        }
        _ => {}
    }
}

fn add_note(
    part_id: &str,
    number: u32,
    note: NoteAccumulator,
    measures: &mut BTreeMap<u32, MeasureAccumulator>,
) {
    let measure = measures
        .entry(number)
        .or_insert_with(|| MeasureAccumulator {
            number,
            ..Default::default()
        });
    measure.note_count = measure.note_count.saturating_add(1);
    if note.rest {
        measure.rest_count = measure.rest_count.saturating_add(1);
    }
    if note.chord {
        measure.chord_tones = measure.chord_tones.saturating_add(1);
    }
    let voice = note.voice.unwrap_or_else(|| "unspecified".into());
    let staff = note.staff.unwrap_or_else(|| "unspecified".into());
    insert_bounded(&mut measure.voices, format!("{part_id}:{voice}"));
    insert_bounded(&mut measure.staves, format!("{part_id}:{staff}"));
    for tie in &note.ties {
        insert_bounded(
            &mut measure.ties,
            format!("{part_id}:{staff}:{voice}:{tie}"),
        );
    }
    if measure.pitches_and_rhythms.len() >= MAX_NOTE_TOKENS_PER_MEASURE {
        return;
    }
    let pitch = if note.rest {
        "rest".to_string()
    } else {
        let accidental = match note.alter.unwrap_or(0) {
            -2 => "bb",
            -1 => "b",
            1 => "#",
            2 => "x",
            _ => "",
        };
        format!(
            "{}{}{}",
            note.step.unwrap_or_else(|| "?".into()),
            accidental,
            note.octave.unwrap_or_else(|| "?".into())
        )
    };
    let rhythm = note
        .note_type
        .or(note.duration.map(|duration| format!("duration {duration}")))
        .unwrap_or_else(|| "unspecified rhythm".into());
    let dots = if note.dots == 0 {
        String::new()
    } else {
        format!(" + {} dot(s)", note.dots)
    };
    let chord = if note.chord { " chord-tone" } else { "" };
    measure.pitches_and_rhythms.push(format!(
        "{part_id} staff {staff} voice {voice}: {pitch}, {rhythm}{dots}{chord}"
    ));
}

fn add_direction(number: u32, value: &str, measures: &mut BTreeMap<u32, MeasureAccumulator>) {
    let value = value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(MAX_DIRECTION_CHARS)
        .collect::<String>();
    if !value.is_empty() {
        insert_bounded(&mut measures.entry(number).or_default().directions, value);
    }
}

fn insert_bounded(set: &mut BTreeSet<String>, value: String) {
    if set.len() < MAX_FACT_VALUES_PER_FIELD || set.contains(&value) {
        set.insert(value);
    }
}

fn selected_measure(current: Option<u32>, start: u32, end: u32) -> Option<u32> {
    current.filter(|number| (start..=end).contains(number))
}

fn local_name(event: &BytesStart<'_>) -> String {
    String::from_utf8_lossy(event.local_name().as_ref())
        .chars()
        .take(MAX_XML_TEXT_CHARS)
        .collect()
}

fn attribute(
    event: &BytesStart<'_>,
    key: &[u8],
    decoder: quick_xml::encoding::Decoder,
) -> Option<String> {
    event
        .attributes()
        .with_checks(true)
        .flatten()
        .find(|attribute| attribute.key.as_ref() == key)
        .and_then(|attribute| {
            attribute
                .decoded_and_normalized_value(quick_xml::XmlVersion::Implicit1_0, decoder)
                .ok()
        })
        .map(|value| value.chars().take(MAX_XML_TEXT_CHARS).collect())
}

fn numeric_measure(value: &str) -> Option<u32> {
    value
        .trim()
        .chars()
        .take_while(char::is_ascii_digit)
        .collect::<String>()
        .parse()
        .ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    const SCORE: &str = r#"<?xml version="1.0"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <part-list><score-part id="RH"><part-name>Piano</part-name></score-part><score-part id="LH"><part-name>Piano</part-name></score-part></part-list>
  <part id="RH"><measure number="40"><attributes><divisions>4</divisions><key><fifths>-2</fifths></key><time><beats>3</beats><beat-type>4</beat-type></time></attributes><direction><direction-type><dynamics><f/></dynamics><words>look ahead</words><metronome><per-minute>92</per-minute></metronome></direction-type><sound tempo="92"/></direction><note><pitch><step>B</step><alter>-1</alter><octave>4</octave></pitch><duration>4</duration><type>quarter</type><voice>1</voice><staff>1</staff><tie type="start"/></note><note><chord/><pitch><step>D</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type><voice>1</voice><staff>1</staff></note></measure></part>
  <part id="LH"><measure number="40"><attributes><divisions>4</divisions><key><fifths>-2</fifths></key><time><beats>3</beats><beat-type>4</beat-type></time></attributes><note><rest/><duration>2</duration><type>eighth</type><dot/><voice>2</voice><staff>2</staff></note><note><pitch><step>F</step><octave>2</octave></pitch><duration>2</duration><type>eighth</type><voice>2</voice><staff>2</staff><tie type="stop"/></note></measure></part>
</score-partwise>"#;

    fn piece(root: &Path, xml_path: Option<&Path>) -> PieceDetail {
        PieceDetail {
            id: 1,
            title: "Scherzo".into(),
            composer: Some("Chopin".into()),
            has_xml: xml_path.is_some(),
            has_pdf: false,
            intake_done: true,
            folder_path: root.to_string_lossy().into_owned(),
            xml_path: xml_path.map(|path| path.to_string_lossy().into_owned()),
            pdf_path: None,
            goals: vec![],
            deadline: None,
            target_tempo: None,
            hard_spots: vec![],
            current_state: None,
            notes: None,
        }
    }

    #[test]
    fn synthetic_two_part_score_preserves_notated_facts() {
        let temp = TempDir::new().unwrap();
        let path = temp.path().join("score.musicxml");
        fs::write(&path, SCORE).unwrap();
        let result = summarize(&piece(temp.path(), Some(&path)), Some((40, 40)));
        assert_eq!(result.status, ScoreContextStatus::Ready);
        let measure = &result.measures[0];
        assert_eq!(measure.number, 40);
        assert_eq!(measure.note_count, 4);
        assert_eq!(measure.rest_count, 1);
        assert_eq!(measure.chord_tones, 1);
        assert!(measure.time_signatures.contains(&"3/4".to_string()));
        assert!(measure.tempos.iter().any(|tempo| tempo.contains("92")));
        assert!(measure.dynamics.contains(&"f".to_string()));
        assert!(measure.directions.contains(&"look ahead".to_string()));
        assert!(measure.voices.iter().any(|voice| voice == "RH:1"));
        assert!(measure.voices.iter().any(|voice| voice == "LH:2"));
        assert!(measure
            .pitches_and_rhythms
            .iter()
            .any(|fact| fact.contains("Bb4")));
        assert!(measure.ties.iter().any(|tie| tie.ends_with("start")));
        assert!(measure.ties.iter().any(|tie| tie.ends_with("stop")));
    }

    #[test]
    fn missing_and_unsupported_scores_are_explicit() {
        let temp = TempDir::new().unwrap();
        assert_eq!(
            summarize(&piece(temp.path(), None), Some((1, 2))).status,
            ScoreContextStatus::Missing
        );
        let mxl = temp.path().join("score.mxl");
        fs::write(&mxl, b"not opened").unwrap();
        assert_eq!(
            summarize(&piece(temp.path(), Some(&mxl)), Some((1, 2))).status,
            ScoreContextStatus::Unsupported
        );
    }

    #[test]
    fn plain_xml_is_accepted_only_when_its_root_is_musicxml() {
        let temp = TempDir::new().unwrap();
        let valid = temp.path().join("score.xml");
        fs::write(&valid, SCORE).unwrap();
        assert_eq!(
            summarize(&piece(temp.path(), Some(&valid)), Some((40, 40))).status,
            ScoreContextStatus::Ready
        );
        let other = temp.path().join("notes.xml");
        fs::write(
            &other,
            "<?xml version=\"1.0\"?><notes><measure number=\"40\"/></notes>",
        )
        .unwrap();
        assert_eq!(
            summarize(&piece(temp.path(), Some(&other)), Some((40, 40))).status,
            ScoreContextStatus::Unsupported
        );
    }

    #[test]
    fn path_escape_and_symlink_are_rejected() {
        let piece_root = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        let outside_xml = outside.path().join("outside.musicxml");
        fs::write(&outside_xml, SCORE).unwrap();
        let escaped = summarize(
            &piece(piece_root.path(), Some(&outside_xml)),
            Some((40, 40)),
        );
        assert_eq!(escaped.status, ScoreContextStatus::Unavailable);

        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            let link = piece_root.path().join("link.musicxml");
            symlink(&outside_xml, &link).unwrap();
            let linked = summarize(&piece(piece_root.path(), Some(&link)), Some((40, 40)));
            assert_eq!(linked.status, ScoreContextStatus::Unavailable);
        }
    }

    #[test]
    fn range_is_bounded_before_opening() {
        let temp = TempDir::new().unwrap();
        let result = summarize(&piece(temp.path(), None), Some((1, 100)));
        assert_eq!(result.status, ScoreContextStatus::InvalidRange);
    }

    #[test]
    fn numeric_measure_accepts_suffix_but_not_non_numeric_labels() {
        assert_eq!(numeric_measure("40a"), Some(40));
        assert_eq!(numeric_measure("X1"), None);
    }

    #[test]
    fn parser_rejects_event_and_depth_budget_overruns() {
        assert!(parse(SCORE.as_bytes(), 40, 40, 1).is_err());

        let nested = format!(
            "<score-partwise>{}<measure number=\"1\"/>{}</score-partwise>",
            "<layer>".repeat(MAX_XML_DEPTH),
            "</layer>".repeat(MAX_XML_DEPTH)
        );
        assert!(parse(nested.as_bytes(), 1, 1, MAX_XML_EVENTS).is_err());
    }

    #[test]
    fn repeated_fact_values_are_bounded_per_measure_field() {
        let directions = (0..(MAX_FACT_VALUES_PER_FIELD + 10))
            .map(|index| {
                format!(
                    "<direction><direction-type><words>direction {index}</words></direction-type></direction>"
                )
            })
            .collect::<String>();
        let score = format!(
            "<score-partwise><part id=\"P1\"><measure number=\"1\">{directions}</measure></part></score-partwise>"
        );
        let measures = parse(score.as_bytes(), 1, 1, MAX_XML_EVENTS).unwrap();
        assert_eq!(measures[0].directions.len(), MAX_FACT_VALUES_PER_FIELD);
    }

    #[test]
    fn timewise_scores_cap_distinct_parts_not_repeated_part_elements() {
        let measures = (1..=80)
            .map(|number| {
                format!(
                    "<measure number=\"{number}\"><part id=\"RH\"><note><rest/></note></part><part id=\"LH\"><note><rest/></note></part></measure>"
                )
            })
            .collect::<String>();
        let score = format!(
            "<score-timewise><part-list/><measure number=\"0\"/>{measures}</score-timewise>"
        );
        let facts = parse(score.as_bytes(), 1, 2, MAX_XML_EVENTS).unwrap();
        assert_eq!(facts.len(), 2);
        assert!(facts.iter().all(|measure| measure.note_count == 2));
    }

    #[test]
    #[ignore = "requires Christian's real Scherzo MusicXML fixture"]
    fn real_scherzo_selected_range_is_bounded_and_readable() {
        let root = Path::new(
            "/Users/c3/Desktop/christian's universe/Piano Practice/Pieces/Chopin - Scherzo No.2 Op.31",
        );
        let xml =
            root.join("score/Chopin Scherzo No.2 Op.31 (KernScores, measure-accurate).musicxml");
        let result = summarize(&piece(root, Some(&xml)), Some((40, 42)));
        assert_eq!(result.status, ScoreContextStatus::Ready);
        assert!(!result.measures.is_empty());
        assert!(result
            .measures
            .iter()
            .all(|measure| (40..=42).contains(&measure.number)));
    }
}
