import { useState } from "react";
import { Dialog } from "../../ui/Dialog";
import { StudioMutationError } from "./StudioMutationError";
import type { StudioItem, StudioSlot, StudioSnapshot } from "./studioApi";

const SLOTS: { id: StudioSlot; label: string }[] = [
  { id: "piano", label: "Pianos" },
  { id: "seat", label: "Seating" },
  { id: "shelf", label: "Shelves" },
  { id: "decor", label: "Objects" },
  { id: "room", label: "Rooms" },
  { id: "theme", label: "Palettes" },
];

export function ItemIllustration({ item }: { item: StudioItem }) {
  const premium = item.price >= 300;
  return (
    <svg
      className="studio-item-art"
      viewBox="0 0 120 80"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {item.slot === "piano" ? (
        item.id.includes("grand") ? (
          <>
            <path
              d="M22 45 49 29q12-22 35-9 22 17-6 32L50 67Z"
              fill="currentColor"
              fillOpacity=".12"
            />
            <path d="m25 46 26 12 25-10M30 54v14m24-6v10m26-19v12M49 29l27-19 13 21" />
            <path d="m34 47 23 10m-18-13 22 10" strokeWidth="5" />
          </>
        ) : (
          <>
            <path
              d={
                item.id.includes("upright")
                  ? "M20 29 60 13l41 17v30L61 75 20 58Z"
                  : "M18 37 59 21l43 17-41 17Z"
              }
              fill="currentColor"
              fillOpacity=".12"
            />
            <path d="m23 40 38 14 36-14M27 50v19m34-13v17m32-25v15" />
            <path d="m31 36 32 12" strokeWidth="6" />
          </>
        )
      ) : null}
      {item.slot === "seat" && (
        <>
          <path
            d="m30 32 29-10 32 11-30 12Z"
            fill="currentColor"
            fillOpacity=".15"
          />
          <path
            d={
              item.id === "seat-box"
                ? "M30 32v23l31 13 30-13V33M61 45v23"
                : "M31 35v8l30 12 30-12v-9M37 45v18m25-10v18m22-25v17"
            }
          />
          {premium && <path d="m45 29 28 11m-14-17 2 21" />}
        </>
      )}
      {item.slot === "shelf" &&
        (item.id.includes("none") ? (
          <path d="M33 50h54" strokeDasharray="3 5" />
        ) : (
          <>
            {(premium ? [0, 1, 2] : [1]).map((i) => (
              <g key={i} transform={`translate(0 ${i * 18})`}>
                <path
                  d="M24 18h72v4H24Z"
                  fill="currentColor"
                  fillOpacity=".15"
                />
                <path d="M35 6v12m9-14v14m9-10v10m15-13 5 13" strokeWidth="6" />
              </g>
            ))}
          </>
        ))}
      {item.slot === "decor" &&
        (item.id.includes("plant") ? (
          <>
            <path
              d="M45 50h30l-5 23H50Z"
              fill="currentColor"
              fillOpacity=".15"
            />
            <path d="M60 50V18m0 21-16-14m16 7 15-13" />
            <ellipse
              cx="44"
              cy="23"
              rx="7"
              ry="12"
              transform="rotate(-35 44 23)"
            />
            <ellipse
              cx="73"
              cy="17"
              rx="7"
              ry="12"
              transform="rotate(30 73 17)"
            />
          </>
        ) : item.id.includes("lamp") ? (
          <>
            <path
              d="M46 12h28l12 23H34Z"
              fill="currentColor"
              fillOpacity=".15"
            />
            <path d="M60 35v33m-17 0h34" />
          </>
        ) : item.id.includes("table") ? (
          <>
            <path
              d="m28 32 30-13 36 14-31 14Z"
              fill="currentColor"
              fillOpacity=".15"
            />
            <path d="M28 32v8l35 14 31-14v-7M35 43v22m28-11v20m23-30v21" />
            <path
              d="m43 31 14-6 19 7-13 6Z"
              fill="currentColor"
              fillOpacity=".2"
            />
          </>
        ) : item.id.includes("art") ? (
          <>
            <rect x="34" y="10" width="52" height="60" rx="2" />
            <path d="m43 57 12-29 12 17 10-21" strokeWidth="5" />
          </>
        ) : item.id.includes("sculpture") ? (
          <>
            <path d="M44 62h32v10H44Z" />
            <path d="M60 62q-24-14 0-30t0-22q22 16 0 30t0 22" strokeWidth="6" />
          </>
        ) : (
          <path d="M36 45h48" strokeDasharray="3 5" />
        ))}
      {item.slot === "room" && (
        <>
          <path
            d="M20 28 59 13l41 15v31L60 75 20 59Z"
            fill="currentColor"
            fillOpacity=".08"
          />
          <path d="M59 13v30L20 59m39-16 41 16" />
          <path
            d="m71 29 17 6v17l-17-6Z"
            fill="currentColor"
            fillOpacity=".18"
          />
        </>
      )}
      {item.slot === "theme" && (
        <>
          {[0, 1, 2].map((i) => (
            <circle
              key={i}
              cx={38 + i * 23}
              cy="41"
              r="17"
              fill={
                item.id.includes("sand")
                  ? ["#d5be98", "#a18562", "#685c50"][i]
                  : item.id.includes("forest")
                    ? ["#bed3be", "#7cae98", "#426552"][i]
                    : item.id.includes("midnight")
                      ? ["#b2bde0", "#788fbf", "#454d70"][i]
                      : ["#d5dde6", "#8d9ba9", "#555e6e"][i]
              }
              stroke="none"
            />
          ))}
        </>
      )}
    </svg>
  );
}

export function StudioShop({
  snapshot,
  busy,
  onBuy,
  onEquip,
}: {
  snapshot: StudioSnapshot;
  busy: boolean;
  onBuy: (item: StudioItem) => Promise<boolean>;
  onEquip: (item: StudioItem) => Promise<boolean>;
}) {
  const [slot, setSlot] = useState<StudioSlot>("decor");
  const [purchase, setPurchase] = useState<StudioItem | null>(null);
  const items = snapshot.catalog.filter((item) => item.slot === slot);
  return (
    <section className="studio-shop" aria-label="Furnish your room">
      <div className="studio-section-heading">
        <div>
          <h2>Make it yours.</h2>
          <p>Small beginnings. A room shaped by the work you put in.</p>
        </div>
        <span className="studio-coin-balance">
          {snapshot.wallet.balance.toLocaleString()} coins available
        </span>
      </div>
      <div
        className="studio-categories"
        role="group"
        aria-label="Furnishing categories"
      >
        {SLOTS.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={slot === s.id}
            onClick={() => setSlot(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="studio-shop-grid">
        {items.map((item) => {
          const owned = snapshot.owned_item_ids.includes(item.id);
          const equipped = snapshot.equipped[item.slot] === item.id;
          const rankLocked = snapshot.progress.rank_index < item.unlock_rank;
          const afford = snapshot.wallet.balance >= item.price;
          return (
            <article
              className={`studio-shop-item${equipped ? " is-equipped" : ""}`}
              key={item.id}
            >
              <div className="studio-item-preview">
                <ItemIllustration item={item} />
                {equipped && (
                  <span className="studio-equipped-label">In your room</span>
                )}
              </div>
              <h3>{item.name}</h3>
              <p>{item.description}</p>
              <button
                type="button"
                className={owned ? "studio-secondary" : "studio-buy"}
                disabled={
                  busy || equipped || (!owned && (rankLocked || !afford))
                }
                onClick={() => (owned ? void onEquip(item) : setPurchase(item))}
              >
                {equipped
                  ? "Equipped"
                  : owned
                    ? "Use in room"
                    : rankLocked
                      ? `Unlocks at rank ${item.unlock_rank}`
                      : !afford
                        ? `${item.price - snapshot.wallet.balance} more coins`
                        : `${item.price} coins · Get`}
              </button>
              {!owned && (
                <span className="studio-item-price">
                  {item.price} coins
                  {rankLocked ? ` · Rank ${item.unlock_rank}` : ""}
                </span>
              )}
            </article>
          );
        })}
      </div>
      <p className="studio-footnote">
        Earn 25 coins with every division. Owned furnishings are yours to switch
        freely.
      </p>
      <Dialog
        open={purchase !== null}
        onClose={() => {
          if (!busy) setPurchase(null);
        }}
        label="Get furnishing"
        className="studio-dialog"
      >
        {purchase && (
          <>
            <StudioMutationError />
            <div className="studio-purchase-art">
              <ItemIllustration item={purchase} />
            </div>
            <h2>Bring home {purchase.name.toLowerCase()}?</h2>
            <p>
              {purchase.price} coins. Your balance after:{" "}
              {(snapshot.wallet.balance - purchase.price).toLocaleString()}{" "}
              coins.
            </p>
            <p className="studio-footnote">
              It will be placed in your room immediately. This uses earned coins
              only.
            </p>
            <div className="studio-dialog-actions">
              <button
                type="button"
                className="studio-secondary"
                disabled={busy}
                onClick={() => setPurchase(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="studio-primary"
                disabled={busy}
                onClick={() => {
                  void onBuy(purchase).then((ok) => {
                    if (ok) setPurchase(null);
                  });
                }}
              >
                {busy ? "Saving…" : `Get for ${purchase.price} coins`}
              </button>
            </div>
          </>
        )}
      </Dialog>
    </section>
  );
}
