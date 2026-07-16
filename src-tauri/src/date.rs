//! Strict Gregorian calendar dates shared by every backend feature.
//!
//! Calendar input is accepted only as an exact `YYYY-MM-DD` value in years
//! 0001–9999. Keeping parsing and arithmetic here prevents planner ranking,
//! metrics, Brain intake, and Calendar recovery from disagreeing about leap
//! days or impossible dates.

use std::fmt;

/// A validated proleptic-Gregorian calendar date.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct Date {
    days_since_epoch: i64,
}

impl Date {
    /// Parse one exact `YYYY-MM-DD` date. Whitespace, variable-width fields,
    /// year zero, and impossible month/day combinations are rejected.
    pub(crate) fn parse(value: &str) -> Option<Self> {
        let bytes = value.as_bytes();
        if bytes.len() != 10
            || bytes[4] != b'-'
            || bytes[7] != b'-'
            || !bytes
                .iter()
                .enumerate()
                .all(|(index, byte)| matches!(index, 4 | 7) || byte.is_ascii_digit())
        {
            return None;
        }
        let year = value[0..4].parse::<i64>().ok()?;
        let month = value[5..7].parse::<i64>().ok()?;
        let day = value[8..10].parse::<i64>().ok()?;
        if year == 0 || day == 0 || day > days_in_month(year, month)? {
            return None;
        }
        Some(Self {
            days_since_epoch: days_from_civil(year, month, day),
        })
    }

    pub(crate) fn days_since_epoch(self) -> i64 {
        self.days_since_epoch
    }

    /// Add whole calendar days, returning `None` outside the four-digit year
    /// range. Recovery uses this instead of timestamp arithmetic around DST.
    #[allow(dead_code)] // consumed by the P5.5 recovery engine landing next
    pub(crate) fn add_days(self, days: i64) -> Option<Self> {
        let candidate = Self {
            days_since_epoch: self.days_since_epoch.checked_add(days)?,
        };
        let (year, _, _) = civil_from_days(candidate.days_since_epoch);
        (1..=9_999).contains(&year).then_some(candidate)
    }
}

impl fmt::Display for Date {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let (year, month, day) = civil_from_days(self.days_since_epoch);
        write!(formatter, "{year:04}-{month:02}-{day:02}")
    }
}

pub(crate) fn is_valid(value: &str) -> bool {
    Date::parse(value).is_some()
}

fn days_in_month(year: i64, month: i64) -> Option<i64> {
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => Some(31),
        4 | 6 | 9 | 11 => Some(30),
        2 if leap => Some(29),
        2 => Some(28),
        _ => None,
    }
}

/// Howard Hinnant's `days_from_civil`, normalized to Unix epoch day zero.
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let day_of_year = (153 * (if month > 2 { month - 3 } else { month + 9 }) + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

/// Inverse of `days_from_civil`.
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let day_of_era = z - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    year += i64::from(month <= 2);
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strict_shape_and_real_gregorian_days() {
        for valid in ["0001-01-01", "2000-02-29", "2024-02-29", "9999-12-31"] {
            assert!(Date::parse(valid).is_some(), "{valid}");
        }
        for invalid in [
            "",
            "2026-1-01",
            "2026-01-1",
            " 2026-01-01",
            "0000-01-01",
            "1900-02-29",
            "2026-02-29",
            "2026-04-31",
            "2026-00-10",
            "2026-13-01",
            "2026-01-00",
            "2026-01-32",
        ] {
            assert!(Date::parse(invalid).is_none(), "{invalid}");
        }
    }

    #[test]
    fn day_arithmetic_crosses_month_year_and_leap_boundaries() {
        assert_eq!(
            Date::parse("2024-02-28")
                .unwrap()
                .add_days(1)
                .unwrap()
                .to_string(),
            "2024-02-29"
        );
        assert_eq!(
            Date::parse("2024-02-29")
                .unwrap()
                .add_days(1)
                .unwrap()
                .to_string(),
            "2024-03-01"
        );
        assert_eq!(
            Date::parse("2026-12-31")
                .unwrap()
                .add_days(1)
                .unwrap()
                .to_string(),
            "2027-01-01"
        );
        assert_eq!(
            Date::parse("2026-01-01")
                .unwrap()
                .add_days(-1)
                .unwrap()
                .to_string(),
            "2025-12-31"
        );
    }

    #[test]
    fn local_midnight_uses_calendar_days_not_utc_date_slices() {
        // 2026-07-12 02:30 UTC is still July 11 at UTC-04:00.
        let utc =
            Date::parse("2026-07-12").unwrap().days_since_epoch() * 86_400 + 2 * 3_600 + 30 * 60;
        let new_york_day = (utc - 4 * 3_600).div_euclid(86_400);
        let tokyo_day = (utc + 9 * 3_600).div_euclid(86_400);
        assert_eq!(
            Date {
                days_since_epoch: new_york_day
            }
            .to_string(),
            "2026-07-11"
        );
        assert_eq!(
            Date {
                days_since_epoch: tokyo_day
            }
            .to_string(),
            "2026-07-12"
        );
    }

    #[test]
    fn unix_epoch_is_day_zero() {
        assert_eq!(Date::parse("1970-01-01").unwrap().days_since_epoch(), 0);
    }
}
