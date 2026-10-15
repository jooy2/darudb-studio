import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { mainChannels } from '@/common/ipc';
import type { Row, SortKey } from '@/common/data';

/*
 * A collection's objects, read a page at a time as the grid scrolls to them.
 *
 * A new filter or sort starts from nothing. A new revision, which a write or a
 * refresh raises, keeps showing the pages read before until their new reads
 * answer, so the grid does not blank out under the user after every edit.
 * */

export const PAGE_SIZE = 200;

// The most pages kept at once; the ones farthest from where the grid reads go first
const MAX_PAGES = 60;

export interface PagedRowsRequest {
  collection: string;
  filter: string;
  sort: SortKey[];
  revision: number;
}

export interface PagedRows {
  /* How many objects the filter finds, or `null` until the first page answers */
  total: number | null;
  error: string | null;
  rowAt: (index: number) => Row | undefined;
  /* Reads the pages that hold rows `start` to `end`, the ones it lacks */
  load: (start: number, end: number) => void;
}

/* What the last answer said, for the query it answered */
interface Answer {
  query: string;
  total: number | null;
  error: string | null;
  /* Raised as pages arrive, which draws the grid again */
  arrivals: number;
}

export default function usePagedRows(request: PagedRowsRequest | null): PagedRows {
  const pages = useRef(new Map<number, Row[]>());
  // The pages of the revision before, shown until the new reads answer
  const stalePages = useRef(new Map<number, Row[]>());
  const reading = useRef(new Set<number>());
  const generation = useRef(0);
  // The rows the grid last asked for, which a new revision reads again
  const shownRange = useRef<{ start: number; end: number } | null>(null);

  const collection = request?.collection ?? null;
  const filter = request?.filter ?? '';
  const sortText = JSON.stringify(request?.sort ?? []);
  const revision = request?.revision ?? 0;
  const queryKey = `${collection}\u0000${filter}\u0000${sortText}`;
  const query = useMemo(
    () =>
      collection === null ? null : { collection, filter, sort: JSON.parse(sortText) as SortKey[] },
    [collection, filter, sortText],
  );
  // An answer to another filter or sort counts for nothing here
  const [answer, setAnswer] = useState<Answer>({
    query: '',
    total: null,
    error: null,
    arrivals: 0,
  });
  const current = answer.query === queryKey ? answer : null;

  const readPage = useCallback(
    async (page: number): Promise<void> => {
      if (!query || pages.current.has(page) || reading.current.has(page)) {
        return;
      }

      const started = generation.current;

      reading.current.add(page);

      const result = await window.mainApi.invoke(mainChannels.readPage, {
        ...query,
        offset: page * PAGE_SIZE,
        limit: PAGE_SIZE,
      });

      // An answer for a filter, sort or revision that has since changed
      if (started !== generation.current) {
        return;
      }

      reading.current.delete(page);

      if (result.status === 'error') {
        setAnswer((last) => ({
          query: queryKey,
          total: last.query === queryKey ? (last.total ?? 0) : 0,
          error: result.message,
          arrivals: last.arrivals + 1,
        }));

        return;
      }

      pages.current.set(page, result.rows);
      stalePages.current.delete(page);

      if (pages.current.size > MAX_PAGES) {
        const farthest = [...pages.current.keys()].sort(
          (a, b) => Math.abs(b - page) - Math.abs(a - page),
        )[0];

        pages.current.delete(farthest);
      }

      setAnswer((last) => ({
        query: queryKey,
        total: result.total,
        error: null,
        arrivals: last.arrivals + 1,
      }));
    },
    [query, queryKey],
  );

  /* Reads the pages that hold rows `start` to `end`, the ones it lacks */
  const readRange = useCallback(
    (start: number, end: number): void => {
      const first = Math.floor(Math.max(0, start) / PAGE_SIZE);
      const last = Math.floor(Math.max(0, end) / PAGE_SIZE);

      for (let page = first; page <= last; page += 1) {
        void readPage(page);
      }
    },
    [readPage],
  );

  // A new filter or sort: nothing read before holds
  useEffect(() => {
    generation.current += 1;
    pages.current = new Map();
    stalePages.current = new Map();
    reading.current = new Set();
    shownRange.current = null;
    // `readPage` sets state only once its read answers, never during the effect
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void readPage(0);
  }, [readPage]);

  // A new revision: the pages read before are shown until they are read again
  const lastRevision = useRef(revision);

  useEffect(() => {
    if (lastRevision.current === revision) {
      return;
    }

    lastRevision.current = revision;
    generation.current += 1;
    stalePages.current = new Map([...stalePages.current, ...pages.current]);
    pages.current = new Map();
    reading.current = new Set();
    // The first page, for how many objects there are now, and the rows in view,
    // which the grid does not ask for again while it stays where it is
    void readPage(0);

    if (shownRange.current) {
      readRange(shownRange.current.start, shownRange.current.end);
    }
  }, [revision, readPage, readRange]);

  const rowAt = useCallback((index: number): Row | undefined => {
    const page = Math.floor(index / PAGE_SIZE);
    const rows = pages.current.get(page) ?? stalePages.current.get(page);

    return rows?.[index % PAGE_SIZE];
  }, []);

  const load = useCallback(
    (start: number, end: number): void => {
      shownRange.current = { start, end };
      readRange(start, end);
    },
    [readRange],
  );

  return { total: current?.total ?? null, error: current?.error ?? null, rowAt, load };
}
