import { configure } from "@testing-library/dom";

// Testing Library's default `waitFor` timeout is 1000 ms. Several suites here
// assert on state that only settles after an async round-trip through the
// devMock (`invoke` → persist → refetch → re-render), which comfortably fits
// in 1000 ms on an idle machine and does NOT when the machine is busy.
//
// That is exactly how it failed: the release script runs the full suite and a
// production build, and under that load `DaySheet.test.tsx`'s "re-totals when
// a block is edited" timed out and failed gate 2/8 — while passing 5/5 when
// run on its own. A test whose result depends on how loaded an 8 GB laptop is
// tells us nothing about the code, and a release gate that fails randomly
// trains people to re-run it until it goes green, which is how a real failure
// eventually gets waved through.
//
// A longer ceiling does not weaken any assertion: `waitFor` still fails if the
// expected state never arrives. It only stops the clock, rather than the code,
// from deciding the outcome.
configure({ asyncUtilTimeout: 5000 });
