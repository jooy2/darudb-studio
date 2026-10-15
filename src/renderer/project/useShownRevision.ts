import { useState } from 'react';

/*
 * The revision a tab reads its objects by: the newest while the tab is in
 * view, and the one it was last in view for while it is behind another. A
 * write then reads again only the tabs in view, and each of the others once
 * it comes to the front.
 * */
export default function useShownRevision(revision: number, shown: boolean): number {
  const [kept, setKept] = useState(revision);

  // Caught up while the draw that shows the tab is under way
  if (shown && kept !== revision) {
    setKept(revision);
  }

  return shown ? revision : kept;
}
