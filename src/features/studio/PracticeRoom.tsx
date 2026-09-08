import { useId } from "react";
import type { StudioEquipped } from "./studioApi";

/** A small, offline vector stage. Equipment changes geometry, not just labels. */
export function PracticeRoom({
  equipped,
  label = "Your practice room",
}: {
  equipped: StudioEquipped;
  label?: string;
}) {
  const id = useId().replace(/:/g, "");
  const oak = equipped.room === "room-oak";
  const loft = equipped.room === "room-loft";
  const conservatory = equipped.room === "room-conservatory";
  const grand = equipped.piano.includes("grand");
  const upright = equipped.piano === "piano-upright";
  const concert = equipped.piano === "piano-concert-grand";
  const wall = conservatory
    ? "#d5e0d8"
    : oak
      ? "#c5ac92"
      : loft
        ? "#a6a5a2"
        : "#c4c9d1";
  const floor = oak
    ? "#a67d58"
    : loft
      ? "#a09c96"
      : conservatory
        ? "#bbbdad"
        : "#999ea8";
  return (
    <svg
      className="practice-room"
      viewBox="0 0 800 530"
      role="img"
      aria-label={label}
    >
      <defs>
        <linearGradient id={`${id}-wall`} x2="0" y2="1">
          <stop stopColor={wall} />
          <stop offset="1" stopColor={wall} stopOpacity=".72" />
        </linearGradient>
        <linearGradient id={`${id}-floor`} x2="0" y2="1">
          <stop stopColor={floor} />
          <stop offset="1" stopColor="#5a606b" />
        </linearGradient>
        <linearGradient id={`${id}-window`} x2="0" y2="1">
          <stop stopColor="#d9ebf7" />
          <stop offset="1" stopColor="#91a4b5" />
        </linearGradient>
        <linearGradient id={`${id}-piano`} x2=".8" y2="1">
          <stop
            stopColor={upright ? "#80614c" : concert ? "#35333b" : "#414750"}
          />
          <stop offset=".5" stopColor={upright ? "#453126" : "#171b23"} />
          <stop offset="1" stopColor="#080d15" />
        </linearGradient>
        <radialGradient id={`${id}-light`}>
          <stop stopColor="#e1d1ac" stopOpacity=".32" />
          <stop offset="1" stopColor="#e1d1ac" stopOpacity="0" />
        </radialGradient>
        <filter
          id={`${id}-shadow`}
          x="-40%"
          y="-70%"
          width="180%"
          height="240%"
        >
          <feGaussianBlur stdDeviation="13" />
        </filter>
      </defs>
      <ellipse
        cx="408"
        cy="443"
        rx="288"
        ry="49"
        fill="#000"
        opacity=".22"
        filter={`url(#${id}-shadow)`}
      />
      {/* Open front, two walls and a real floor; no fake interaction targets. */}
      <path d="M112 299 400 407 688 299 400 196Z" fill={`url(#${id}-floor)`} />
      <path d="M112 299V121L400 44V196Z" fill={`url(#${id}-wall)`} />
      <path d="M400 44 688 121V299L400 196Z" fill={wall} opacity=".87" />
      <path d="M112 299 400 407 688 299V310L400 419 112 310Z" fill="#505763" />
      <path
        d="M112 298 400 405 688 298M400 47V196"
        fill="none"
        stroke="#f1f2ef"
        strokeOpacity=".3"
        strokeWidth="2"
      />
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <path
          key={i}
          d={`M${148 + i * 36} ${312 + i * 13.5}l288 -107`}
          stroke="#263342"
          strokeOpacity=".16"
        />
      ))}
      {loft &&
        [0, 1, 2, 3, 4].map((i) => (
          <path
            key={i}
            d={`M114 ${155 + i * 28}l284 -76`}
            stroke="#474e57"
            strokeOpacity=".25"
          />
        ))}
      {/* Window and the daylight it casts. */}
      <path
        d={
          conservatory
            ? "M443 73 655 130V268L443 193Z"
            : "M470 94 620 134V238L470 185Z"
        }
        fill="#697989"
        stroke="#e5e9e9"
        strokeWidth="7"
      />
      <path
        d={
          conservatory
            ? "M450 83 648 136V256L450 188Z"
            : "M477 104 613 140V227L477 180Z"
        }
        fill={`url(#${id}-window)`}
      />
      <path
        d={
          conservatory
            ? "M550 110V224M451 137l196 55"
            : "M545 122V204M478 145l136 38"
        }
        stroke="#edf0ed"
        strokeWidth="5"
      />
      <path
        d="M484 246 586 280 433 354 309 308Z"
        fill="#f5ead5"
        opacity=".12"
      />
      {/* Shelf occupies the left wall. */}
      {equipped.shelf !== "shelf-none" && (
        <g>
          {(equipped.shelf === "shelf-library" ? [0, 1, 2] : [1]).map((row) => (
            <g key={row} transform={`translate(0 ${row * 32})`}>
              <path d="M149 153 306 111 324 121 166 165Z" fill="#987657" />
              <path d="M166 165v7l158 -43v-8Z" fill="#634d3d" />
              {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                <path
                  key={i}
                  d={`M${177 + i * 14} ${146 - i * 3.8}v-25l9 -2v25Z`}
                  fill={["#647c81", "#aa967a", "#515a72", "#a4a9a0"][i % 4]}
                />
              ))}
            </g>
          ))}
        </g>
      )}
      {/* Instrument: digital, upright or sculptural grand. */}
      <ellipse
        cx="382"
        cy="306"
        rx="148"
        ry="25"
        fill="#141a26"
        opacity=".22"
      />
      {grand ? (
        <g>
          <path
            d="M247 257 348 217Q383 132 444 168Q535 218 452 284L367 329Z"
            fill={`url(#${id}-piano)`}
          />
          <path
            d="M251 257 348 222Q389 149 444 174Q511 217 452 271L368 309Z"
            fill={concert ? "#48444b" : "#343c47"}
            stroke="#c7b69a"
            strokeWidth="2"
          />
          <path
            d="M351 218 431 105 482 185 453 267Z"
            fill="#242a34"
            stroke="#606674"
            strokeWidth="2"
          />
          <path d="M351 218 431 105 444 174Z" fill="#4a505a" />
          <path d="M366 273 379 165" stroke="#b79b69" strokeWidth="3" />
          <path
            d="M258 278v47l9 3v-46M368 320v42l9 -3v-43M452 281v42l8 -4v-43"
            fill="#151b25"
          />
        </g>
      ) : upright ? (
        <g>
          <path
            d="M247 190 375 144 492 187V287L367 334 247 288Z"
            fill={`url(#${id}-piano)`}
          />
          <path
            d="M247 190 375 144 492 187 367 235Z"
            fill="#414650"
            stroke="#808187"
          />
          <path
            d="M260 206 366 244 481 202V257L367 300 260 260Z"
            fill="#272d36"
          />
          <path d="M259 283v43l9 3v-42M371 326v36l8 -3v-36" fill="#121923" />
        </g>
      ) : (
        <g>
          <path
            d="M253 267 368 225 489 267 373 312Z"
            fill={`url(#${id}-piano)`}
          />
          <path d="M253 267v12l120 44 116 -45v-11l-116 45Z" fill="#202834" />
          <path
            d="m279 287 83 80m-76 -17 69 -36m117 -38 -68 68m-8 -21 70 2"
            stroke="#2e3845"
            strokeWidth="7"
            strokeLinecap="round"
          />
        </g>
      )}
      {/* Keys share one perspective and remain crisp at any window size. */}
      <g transform={upright ? "translate(0 -3)" : undefined}>
        <path d="M257 260 281 251 389 291 367 301Z" fill="#e8e7df" />
        {Array.from({ length: 24 }, (_, i) => (
          <path
            key={i}
            d={`M${260 + i * 4.45} ${261 + i * 1.67}l21 -8`}
            stroke="#57606b"
            strokeWidth=".6"
          />
        ))}
        {Array.from({ length: 17 }, (_, i) =>
          i % 7 === 2 || i % 7 === 6 ? null : (
            <path
              key={i}
              d={`M${271 + i * 5.5} ${258 + i * 2.05}l12 -4.4 2.8 1.05 -12 4.4Z`}
              fill="#111722"
            />
          ),
        )}
      </g>
      {/* Music stand and open score. */}
      <path d="M341 222 379 235 387 199 349 187Z" fill="#333e4a" />
      <path d="M342 215 361 219 366 190 348 185Z" fill="#e9e7dc" />
      <path d="M361 219 380 227 385 198 366 190Z" fill="#d5d5cf" />
      {[0, 1, 2].map((i) => (
        <path
          key={i}
          d={`M350 ${194 + i * 6}l11 3m8 -1 10 4`}
          stroke="#5e6670"
          strokeWidth="1"
        />
      ))}
      {/* The starter is intentionally humble. Upgrades visibly replace it. */}
      {equipped.seat === "seat-box" ? (
        <g>
          <path d="M284 334 318 321 356 335 322 350Z" fill="#ae9273" />
          <path d="M284 334v31l38 16v-31Z" fill="#9e7f5f" />
          <path d="M322 350v31l34 -16v-30Z" fill="#7e634d" />
          <path
            d="M302 328 339 343v28M296 352l13 5"
            stroke="#ceaf85"
            strokeWidth="3"
          />
        </g>
      ) : (
        <g>
          <path
            d="M280 337 318 323 362 340 323 356Z"
            fill={equipped.seat === "seat-tufted" ? "#765d58" : "#333b46"}
            stroke="#626a72"
          />
          <path d="M280 337v9l43 17 39 -15v-8" fill="#202936" />
          <path
            d="M288 346v31m64 -29v25m-30 -13v32"
            stroke="#242e3a"
            strokeWidth={equipped.seat === "seat-stool" ? "5" : "8"}
          />
          {equipped.seat === "seat-tufted" && (
            <path
              d="m301 337 37 14m-19 -21 26 11"
              stroke="#af8b79"
              strokeWidth="1.5"
            />
          )}
        </g>
      )}
      {/* One deliberately chosen decorative statement. */}
      {equipped.decor === "decor-plant" && (
        <g>
          <path d="M575 290h39l-8 38h-23Z" fill="#a98670" />
          <ellipse cx="595" cy="289" rx="20" ry="7" fill="#6d6658" />
          <path
            d="M595 291V224m0 43-20-26m20 9 23-25"
            fill="none"
            stroke="#456c5a"
            strokeWidth="4"
          />
          <ellipse
            cx="583"
            cy="238"
            rx="11"
            ry="24"
            transform="rotate(-40 583 238)"
            fill="#527760"
          />
          <ellipse
            cx="609"
            cy="221"
            rx="12"
            ry="23"
            transform="rotate(37 609 221)"
            fill="#698f70"
          />
          <ellipse cx="594" cy="216" rx="10" ry="23" fill="#426954" />
        </g>
      )}
      {equipped.decor === "decor-lamp" && (
        <g>
          <ellipse
            cx="584"
            cy="288"
            rx="100"
            ry="82"
            fill={`url(#${id}-light)`}
          />
          <ellipse cx="587" cy="316" rx="22" ry="8" fill="#51545c" />
          <path d="M587 314V206" stroke="#8b7b64" strokeWidth="5" />
          <path d="M565 180h42l13 34q-33 16-66 0Z" fill="#e4d6b4" />
        </g>
      )}
      {equipped.decor === "decor-table" && (
        <g>
          <ellipse
            cx="586"
            cy="306"
            rx="36"
            ry="10"
            fill="#252e39"
            opacity=".18"
          />
          <path
            d="M559 269 586 258 618 270 591 283Z"
            fill="#a88968"
            stroke="#c1a586"
          />
          <path d="M559 269v8l32 13 27-12v-8l-27 13Z" fill="#72553e" />
          <path
            d="M565 280v32m44-29v27m-19-22v35"
            stroke="#694e3c"
            strokeWidth="5"
          />
          <path d="m571 269 16-6 17 6-16 7Z" fill="#dad5c6" />
          <path d="m578 270 10-4m-4 7 10-4" stroke="#6e797c" />
        </g>
      )}
      {equipped.decor === "decor-art" && (
        <g>
          <path d="M185 142 262 121v73l-77 24Z" fill="#646063" />
          <path d="M190 146 257 128v61l-67 22Z" fill="#e1d7bd" />
          <path
            d="m201 188 13-38 17 30 16-40"
            fill="none"
            stroke="#789098"
            strokeWidth="8"
          />
        </g>
      )}
      {equipped.decor === "decor-sculpture" && (
        <g>
          <path d="M575 276 599 267 625 277v45l-24 10-26-11Z" fill="#aaa9a1" />
          <path
            d="M599 268q-34-34 0-58t0-51q38 31 7 59t-7 50"
            fill="none"
            stroke="#b49a6d"
            strokeWidth="10"
          />
        </g>
      )}
      <path
        d="M112 121 400 44 688 121"
        fill="none"
        stroke="#f3f3ed"
        strokeOpacity=".45"
        strokeWidth="2"
      />
    </svg>
  );
}
