import { useEffect, useRef, useState } from "react";

type AudioContextConstructor = new () => AudioContext;

function audioContextConstructor(): AudioContextConstructor | null {
  const candidate = window as Window & {
    webkitAudioContext?: AudioContextConstructor;
  };
  return window.AudioContext ?? candidate.webkitAudioContext ?? null;
}

/** Output-only gain. It makes a quiet piano take easier to judge without
 * altering the stored evidence or pretending to normalize its dynamics. */
export function PianoPlayback({
  src,
  autoPlay = false,
  onEnded,
}: {
  src: string;
  autoPlay?: boolean;
  onEnded?: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const [gain, setGain] = useState(1.35);

  const connectGain = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!contextRef.current) {
      const Constructor = audioContextConstructor();
      if (!Constructor) return;
      const context = new Constructor();
      const source = context.createMediaElementSource(audio);
      const gainNode = context.createGain();
      gainNode.gain.value = gain;
      source.connect(gainNode);
      gainNode.connect(context.destination);
      contextRef.current = context;
      gainRef.current = gainNode;
    }
    if (contextRef.current.state === "suspended") {
      await contextRef.current.resume().catch(() => undefined);
    }
  };

  useEffect(() => {
    if (gainRef.current) gainRef.current.gain.value = gain;
  }, [gain]);

  useEffect(
    () => () => {
      void contextRef.current?.close().catch(() => undefined);
      contextRef.current = null;
      gainRef.current = null;
    },
    [],
  );

  return (
    <div className="rep-replay-player">
      <audio
        ref={audioRef}
        controls
        autoPlay={autoPlay}
        src={src}
        onPlay={() => void connectGain()}
        onEnded={onEnded}
      />
      <label>
        Playback boost
        <input
          type="range"
          min="1"
          max="2"
          step="0.05"
          value={gain}
          onChange={(event) => setGain(Number(event.target.value))}
        />
        <span>{gain.toFixed(2)}×</span>
      </label>
    </div>
  );
}
