import { useEffect, useRef } from "react";
import { useDock } from "./DockProvider";

/** Browsing should leave the music controls reachable without covering content. */
export function PracticeDockPolicy({
  practiceView,
}: {
  practiceView: boolean;
}) {
  const dock = useDock("rep");
  const automaticallyTucked = useRef(false);
  const userChosePanelState = useRef(false);
  const lastUserAction = useRef(dock.userActionVersion);
  const wasPracticeView = useRef(practiceView);

  useEffect(() => {
    if (wasPracticeView.current && !practiceView) {
      userChosePanelState.current = false;
      automaticallyTucked.current = false;
    }
    wasPracticeView.current = practiceView;
    if (lastUserAction.current !== dock.userActionVersion) {
      automaticallyTucked.current = false;
      userChosePanelState.current = true;
      lastUserAction.current = dock.userActionVersion;
    }
    if (practiceView) {
      if (automaticallyTucked.current && dock.isOpen && dock.isMinimized) {
        dock.openAutomatically();
      }
      automaticallyTucked.current = false;
      userChosePanelState.current = false;
    } else if (
      dock.isOpen &&
      !dock.isMinimized &&
      !userChosePanelState.current &&
      !automaticallyTucked.current
    ) {
      automaticallyTucked.current = true;
      dock.minimizeAutomatically();
    }
  }, [practiceView, dock]);

  return null;
}
