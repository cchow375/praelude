//! Local Studio: derived practice XP plus atomic, revisioned cosmetic ownership.
//! Only this namespaced settings value is written. The practice graph and schema
//! are untouched; corrupt saved state is refused rather than silently reset.
mod catalog;
mod progress;
#[cfg(test)]
mod tests;

use std::collections::{BTreeMap, BTreeSet};

use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::Store;
pub use catalog::{StudioItem, StudioSlot};
pub use progress::StudioProgress;

const KEY: &str = "motivation.studio.v1";
const COINS_PER_DIVISION: u64 = 25;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StudioProfile {
    pub display_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct StudioWallet {
    pub earned_coins: u64,
    pub spent_coins: u64,
    pub balance: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct StudioSnapshot {
    pub revision: u64,
    pub profile: StudioProfile,
    pub progress: StudioProgress,
    pub wallet: StudioWallet,
    pub owned_item_ids: Vec<String>,
    pub equipped: BTreeMap<StudioSlot, String>,
    pub catalog: Vec<StudioItem>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Purchase {
    item_id: String,
    price: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SavedStudio {
    version: u32,
    revision: u64,
    profile: StudioProfile,
    purchases: Vec<Purchase>,
    equipped: BTreeMap<StudioSlot, String>,
}

impl Default for SavedStudio {
    fn default() -> Self {
        Self {
            version: 1,
            revision: 0,
            profile: StudioProfile {
                display_name: "Pianist".into(),
            },
            purchases: Vec::new(),
            equipped: catalog::catalog()
                .iter()
                .filter(|item| item.price == 0)
                .map(|item| (item.slot, item.id.into()))
                .collect(),
        }
    }
}

fn normalized_name(value: &str) -> Result<String, String> {
    if value.chars().any(char::is_control) {
        return Err("Display name cannot contain control characters.".into());
    }
    let name = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if name.is_empty() || name.chars().count() > 40 {
        return Err("Choose a display name with 1–40 characters.".into());
    }
    Ok(name)
}

fn owned(saved: &SavedStudio) -> BTreeSet<String> {
    catalog::catalog()
        .into_iter()
        .filter(|item| item.price == 0)
        .map(|item| item.id.into())
        .chain(
            saved
                .purchases
                .iter()
                .map(|purchase| purchase.item_id.clone()),
        )
        .collect()
}

fn validate(saved: &SavedStudio) -> Result<(), String> {
    if saved.version != 1 || saved.revision > progress::MAX_SAFE_INTEGER {
        return Err("Unsupported Studio data version or revision.".into());
    }
    if normalized_name(&saved.profile.display_name)? != saved.profile.display_name {
        return Err("Saved display name is not normalized.".into());
    }
    let catalog = catalog::catalog();
    let mut purchased = BTreeSet::new();
    for purchase in &saved.purchases {
        let item = catalog
            .iter()
            .find(|item| item.id == purchase.item_id)
            .ok_or("Saved Studio contains an unknown item.")?;
        if purchase.price == 0
            || purchase.price != item.price
            || !purchased.insert(&purchase.item_id)
        {
            return Err("Saved Studio contains an invalid or duplicate purchase.".into());
        }
    }
    if saved.equipped.len() != 6 {
        return Err("Saved Studio equipment is incomplete.".into());
    }
    let owned = owned(saved);
    for (slot, item_id) in &saved.equipped {
        if !catalog
            .iter()
            .any(|item| item.id == item_id && item.slot == *slot)
            || !owned.contains(item_id)
        {
            return Err(
                "Saved Studio contains equipment that is not owned or does not fit.".into(),
            );
        }
    }
    Ok(())
}

fn read(conn: &Connection) -> Result<SavedStudio, String> {
    let raw: Option<String> = conn
        .query_row("SELECT value FROM setting WHERE key=?1", [KEY], |row| {
            row.get(0)
        })
        .optional()
        .map_err(|error| error.to_string())?;
    match raw {
        None => Ok(SavedStudio::default()),
        Some(raw) => {
            let saved: SavedStudio = serde_json::from_str(&raw)
                .map_err(|error| format!("Saved Studio could not be read: {error}"))?;
            validate(&saved).map_err(|error| format!("Saved Studio is invalid: {error}"))?;
            Ok(saved)
        }
    }
}

fn snapshot(saved: &SavedStudio, progress: StudioProgress) -> StudioSnapshot {
    let earned_coins = progress.divisions_completed * COINS_PER_DIVISION;
    let spent_coins = saved.purchases.iter().map(|purchase| purchase.price).sum();
    StudioSnapshot {
        revision: saved.revision,
        profile: saved.profile.clone(),
        progress,
        wallet: StudioWallet {
            earned_coins,
            spent_coins,
            // Corrections can reduce derived earnings. Existing possessions are
            // retained, while new purchases wait until earnings cover spending.
            balance: earned_coins.saturating_sub(spent_coins),
        },
        owned_item_ids: owned(saved).into_iter().collect(),
        equipped: saved.equipped.clone(),
        catalog: catalog::catalog(),
    }
}

enum Change<'a> {
    Purchase(&'a str),
    Equip(&'a str),
    Profile(&'a str),
}

impl Store {
    pub fn studio_snapshot(&self) -> Result<StudioSnapshot, String> {
        let mut conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let tx = conn.transaction().map_err(|error| error.to_string())?;
        let saved = read(&tx)?;
        let progress = progress::read(&tx)?;
        let out = snapshot(&saved, progress);
        tx.commit().map_err(|error| error.to_string())?;
        Ok(out)
    }

    pub fn studio_purchase(
        &self,
        item_id: &str,
        expected_revision: u64,
    ) -> Result<StudioSnapshot, String> {
        self.studio_change(Change::Purchase(item_id), expected_revision)
    }

    pub fn studio_equip(
        &self,
        item_id: &str,
        expected_revision: u64,
    ) -> Result<StudioSnapshot, String> {
        self.studio_change(Change::Equip(item_id), expected_revision)
    }

    pub fn studio_profile_save(
        &self,
        display_name: &str,
        expected_revision: u64,
    ) -> Result<StudioSnapshot, String> {
        self.studio_change(Change::Profile(display_name), expected_revision)
    }

    fn studio_change(
        &self,
        change: Change<'_>,
        expected_revision: u64,
    ) -> Result<StudioSnapshot, String> {
        let mut conn = self
            .conn
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        let mut saved = read(&tx)?;
        if saved.revision != expected_revision {
            return Err("Studio changed elsewhere. Refresh it before trying again.".into());
        }
        let progress = progress::read(&tx)?;
        let before = saved.clone();
        match change {
            Change::Profile(name) => saved.profile.display_name = normalized_name(name)?,
            Change::Purchase(item_id) | Change::Equip(item_id) => {
                let item = catalog::catalog()
                    .into_iter()
                    .find(|item| item.id == item_id)
                    .ok_or("That Studio item does not exist.")?;
                let has_item = owned(&saved).contains(item_id);
                if matches!(change, Change::Purchase(_)) && !has_item {
                    if progress.rank_index < item.unlock_rank {
                        return Err(format!("This item unlocks at rank {}.", item.unlock_rank));
                    }
                    if snapshot(&saved, progress.clone()).wallet.balance < item.price {
                        return Err("Keep practicing to earn enough coins for this item.".into());
                    }
                    saved.purchases.push(Purchase {
                        item_id: item_id.into(),
                        price: item.price,
                    });
                } else if !has_item {
                    return Err("Unlock this item before adding it to your room.".into());
                }
                saved.equipped.insert(item.slot, item_id.into());
            }
        }
        if saved != before {
            saved.revision = saved
                .revision
                .checked_add(1)
                .filter(|value| *value <= progress::MAX_SAFE_INTEGER)
                .ok_or("Studio revision limit reached.")?;
            validate(&saved)?;
            let raw = serde_json::to_string(&saved).map_err(|error| error.to_string())?;
            tx.execute(
                "INSERT INTO setting (key,value) VALUES (?1,?2)
                ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                [KEY, &raw],
            )
            .map_err(|error| error.to_string())?;
        }
        let out = snapshot(&saved, progress);
        tx.commit().map_err(|error| error.to_string())?;
        Ok(out)
    }
}
