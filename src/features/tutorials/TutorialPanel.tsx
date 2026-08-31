import { useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { ConfirmDelete } from "../../components/ConfirmDelete";
import type { TutorialClip, TutorialClipDraft, TutorialVideo } from "./types";
import "./TutorialPanel.css";

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

export function formatTutorialTime(value: number) {
  const seconds = Math.max(0, Math.round(value));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export function TutorialPanel({ pieceId, regionId }: { pieceId: number; regionId: number }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videos, setVideos] = useState<TutorialVideo[]>([]);
  const [activeVideoId, setActiveVideoId] = useState<number | null>(null);
  const [activeClip, setActiveClip] = useState<TutorialClip | null>(null);
  const [editing, setEditing] = useState<TutorialClipDraft | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const found = await invoke<TutorialVideo[]>("tutorial_video_scan", { pieceId });
      setVideos(found ?? []);
      setActiveVideoId((current) => current != null && found.some((video) => video.id === current)
        ? current
        : found[0]?.id ?? null);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [pieceId]);

  const regionClips = useMemo(() => videos
    .flatMap((video) => video.clips.map((clip) => ({ clip, video })))
    .filter(({ clip }) => clip.region_id === regionId)
    .sort((a, b) => a.clip.order - b.clip.order || a.clip.start_seconds - b.clip.start_seconds), [regionId, videos]);
  const activeVideo = videos.find((video) => video.id === activeVideoId) ?? videos[0] ?? null;
  const editingClip = editingId == null
    ? null
    : videos.flatMap((video) => video.clips).find((clip) => clip.id === editingId) ?? null;
  const editingSharedCount = editingClip == null
    ? 1
    : videos.flatMap((video) => video.clips).filter((clip) => clip.chapter_id === editingClip.chapter_id).length;

  function loadedMetadata() {
    const player = videoRef.current;
    if (!player || !activeVideo) return;
    setVideoError(null);
    if (activeClip) player.currentTime = activeClip.start_seconds;
    const duration = player.duration;
    if (activeVideo.duration_seconds != null || !Number.isFinite(duration) || duration <= 0) return;
    setVideos((current) => current.map((video) => video.id === activeVideo.id
      ? { ...video, duration_seconds: duration }
      : video));
    void invoke("tutorial_video_update", {
      id: activeVideo.id,
      patch: { duration_seconds: duration },
    }).catch((reason) => setError(errorMessage(reason)));
  }

  function play(video: TutorialVideo, clip: TutorialClip | null) {
    setActiveVideoId(video.id);
    setActiveClip(clip);
    window.requestAnimationFrame(() => {
      const player = videoRef.current;
      if (!player) return;
      player.currentTime = clip?.start_seconds ?? 0;
      void player.play().catch(() => undefined);
    });
  }

  function beginAdd() {
    if (!activeVideo) return;
    const current = videoRef.current?.currentTime ?? 0;
    const suggestedEnd = Math.round(current) + 60;
    setEditingId(null);
    setEditing({
      video_id: activeVideo.id,
      region_id: regionId,
      start_seconds: Math.round(current),
      end_seconds: activeVideo.duration_seconds == null
        ? suggestedEnd
        : Math.min(activeVideo.duration_seconds, suggestedEnd),
      title: "Practice demonstration",
      notes: null,
      order: regionClips.length,
    });
  }

  function beginEdit(clip: TutorialClip) {
    setEditingId(clip.id);
    setEditing({
      video_id: clip.video_id,
      region_id: clip.region_id,
      start_seconds: clip.start_seconds,
      end_seconds: clip.end_seconds,
      title: clip.title,
      notes: clip.notes,
      order: clip.order,
    });
  }

  async function save() {
    if (!editing || saving || !editing.title.trim() || editing.start_seconds < 0 || editing.end_seconds <= editing.start_seconds) return;
    setSaving(true);
    setError(null);
    try {
      if (editingId == null) {
        await invoke("tutorial_clip_create", { args: { ...editing, title: editing.title.trim(), notes: editing.notes?.trim() || null } });
      } else {
        await invoke("tutorial_clip_update", { id: editingId, patch: {
          video_id: editing.video_id,
          start_seconds: editing.start_seconds,
          end_seconds: editing.end_seconds,
          title: editing.title.trim(),
          notes: editing.notes?.trim() || null,
          order: editing.order,
        } });
      }
      setEditing(null);
      setEditingId(null);
      await load();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: number) {
    try {
      await invoke("tutorial_clip_delete", { id });
      if (activeClip?.id === id) setActiveClip(null);
      await load();
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  async function forgetBrokenVideo(id: number) {
    try {
      await invoke("tutorial_video_delete", { id });
      setVideos((current) => current.filter((video) => video.id !== id));
      setActiveVideoId(null);
      setActiveClip(null);
      setVideoError(null);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  if (loading) return <p className="tutorial-empty">Finding tutorial videos…</p>;
  if (videos.length === 0) {
    return (
      <div className="tutorial-empty">
        <strong>No tutorial video yet.</strong>
        <span>Put an MP4, MOV, M4V, or WebM file in this piece’s <code>tutorials</code> folder, then scan again.</span>
        <button type="button" onClick={() => { setLoading(true); void load(); }}>Scan videos</button>
        {error && <p className="ck-inline-error" role="alert">{error}</p>}
      </div>
    );
  }

  return (
    <div className="tutorial-panel">
      <div className="tutorial-video-head">
        <label>
          <span className="ck-label">Tutorial video</span>
          <select value={activeVideo?.id ?? ""} onChange={(event) => { setActiveVideoId(Number(event.target.value)); setActiveClip(null); }}>
            {videos.map((video) => <option value={video.id} key={video.id}>{video.title}</option>)}
          </select>
        </label>
        <div className="tutorial-video-actions">
          <button type="button" onClick={() => { setLoading(true); void load(); }}>Rescan</button>
          <button type="button" onClick={() => activeVideo && invoke("tutorial_video_reveal", { id: activeVideo.id }).catch((reason) => setError(errorMessage(reason)))}>Show file</button>
          <button type="button" onClick={() => activeVideo && play(activeVideo, null)}>Full video</button>
        </div>
      </div>

      {activeVideo && (
        <video
          ref={videoRef}
          controls
          preload="metadata"
          src={convertFileSrc(activeVideo.file_path)}
          onLoadStart={() => setVideoError(null)}
          onLoadedMetadata={loadedMetadata}
          onError={() => setVideoError("This video file could not be opened. Restore it inside the piece’s tutorials folder, then Rescan.")}
          onTimeUpdate={() => {
            const player = videoRef.current;
            if (player && activeClip && player.currentTime >= activeClip.end_seconds) player.pause();
          }}
        >
          This device cannot play the tutorial video.
        </video>
      )}
      {videoError && (
        <div className="tutorial-video-error">
          <p className="ck-inline-error" role="alert">{videoError}</p>
          {activeVideo && (
            <ConfirmDelete
              label={`Forget “${activeVideo.title}”? Its chapter mappings will be deleted from CodaKiller. The video file itself will not be changed.`}
              onConfirm={() => forgetBrokenVideo(activeVideo.id)}
            >
              <button type="button" className="is-danger">Forget broken video</button>
            </ConfirmDelete>
          )}
        </div>
      )}

      <div className="tutorial-chapter-head">
        <strong>For this section</strong>
        <button type="button" onClick={beginAdd}>+ Map clip</button>
      </div>
      {regionClips.length === 0 ? <p className="tutorial-empty">No chapter is mapped to this section yet.</p> : (
        <ul className="tutorial-chapters">
          {regionClips.map(({ clip, video }) => (
            <li key={clip.id} className={activeClip?.id === clip.id ? "is-playing" : ""}>
              <button type="button" className="tutorial-play" onClick={() => play(video, clip)}>
                <span>▶</span>
                <span><strong>{clip.title}</strong><small>{formatTutorialTime(clip.start_seconds)}–{formatTutorialTime(clip.end_seconds)}</small></span>
              </button>
              {clip.notes && <p>{clip.notes}</p>}
              <div className="tutorial-clip-actions">
                <button type="button" onClick={() => beginEdit(clip)}>
                  {videos.flatMap((item) => item.clips).filter((item) => item.chapter_id === clip.chapter_id).length > 1
                    ? "Edit shared chapter"
                    : "Edit chapter"}
                </button>
                <ConfirmDelete label={`Remove “${clip.title}” from this section? The video file stays available.`} onConfirm={() => remove(clip.id)}>
                  <button type="button" className="is-danger">Remove</button>
                </ConfirmDelete>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <form className="tutorial-map-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          {editingId != null && editingSharedCount > 1 && (
            <p className="tutorial-shared-warning" role="note">
              This chapter is linked to {editingSharedCount} tricky sections. Changing its title, times, or notes updates all {editingSharedCount}.
            </p>
          )}
          <label><span className="ck-label">Video</span><select value={editing.video_id} onChange={(event) => setEditing({ ...editing, video_id: Number(event.target.value) })}>{videos.map((video) => <option value={video.id} key={video.id}>{video.title}</option>)}</select></label>
          <label><span className="ck-label">Chapter title</span><input value={editing.title} maxLength={120} onChange={(event) => setEditing({ ...editing, title: event.target.value })} /></label>
          <div className="tutorial-time-fields">
            <label><span className="ck-label">Start (seconds)</span><input type="number" min="0" step="any" value={editing.start_seconds} onChange={(event) => setEditing({ ...editing, start_seconds: Number(event.target.value) })} /></label>
            <button type="button" onClick={() => setEditing({ ...editing, start_seconds: videoRef.current?.currentTime ?? 0 })}>Use current</button>
            <label><span className="ck-label">End (seconds)</span><input type="number" min="0.1" step="any" value={editing.end_seconds} onChange={(event) => setEditing({ ...editing, end_seconds: Number(event.target.value) })} /></label>
            <button type="button" onClick={() => setEditing({ ...editing, end_seconds: videoRef.current?.currentTime ?? editing.end_seconds })}>Use current</button>
          </div>
          <label><span className="ck-label">Why this clip helps</span><textarea rows={2} value={editing.notes ?? ""} onChange={(event) => setEditing({ ...editing, notes: event.target.value || null })} /></label>
          <div className="tutorial-map-actions"><button type="submit" disabled={saving}>{saving ? "Saving…" : "Save mapping"}</button><button type="button" onClick={() => setEditing(null)}>Cancel</button></div>
        </form>
      )}
      {error && <p className="ck-inline-error" role="alert">{error}</p>}
    </div>
  );
}
