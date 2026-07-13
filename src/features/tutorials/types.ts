export interface TutorialClip {
  id: number;
  chapter_id: number;
  video_id: number;
  region_id: number;
  start_seconds: number;
  end_seconds: number;
  title: string;
  notes: string | null;
  order: number;
}

export interface TutorialVideo {
  id: number;
  piece_id: number;
  title: string;
  file_path: string;
  duration_seconds: number | null;
  clips: TutorialClip[];
}

export interface TutorialClipDraft {
  video_id: number;
  region_id: number;
  start_seconds: number;
  end_seconds: number;
  title: string;
  notes: string | null;
  order: number;
}
