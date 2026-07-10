import { Skeleton } from "./Skeleton";
import type { Song } from "../lib/types";
import styles from "../pages/AdminSongsPage.module.css";

// Extracted from AdminSongsPage (T7.2). The catalog table: header, the
// stale-while-revalidate dimming, the first-load skeleton rows, the empty
// state, and the per-row Edit/Delete actions. Pure presentation — all state and
// the API handlers live in useAdminSongs; this component only renders `songs`
// and raises `onEdit` / `onDelete`.

interface SongTableProps {
  songs: Song[];
  loading: boolean;
  busy: boolean;
  onEdit: (song: Song) => void;
  onDelete: (id: string) => void;
}

export function SongTable({ songs, loading, busy, onEdit, onDelete }: SongTableProps) {
  return (
    <div className={styles.tableWrap} aria-busy={loading}>
      {/* Stale-while-revalidate: on a filter/page change we keep the current
          rows on screen (dimmed) while refetching, instead of blanking the
          whole table back to skeletons. Skeletons show only on the very first
          load, when there are no rows to keep. */}
      <table className={`${styles.table} ${loading && songs.length > 0 ? styles.tableStale : ""}`}>
        <thead>
          <tr>
            <th>Title</th>
            <th>Artist</th>
            <th>YouTube ID</th>
            <th>Start</th>
            <th>Year</th>
            <th>Genres</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {loading && songs.length === 0 ? (
            Array.from({ length: 5 }).map((_, i) => (
              <tr key={`s-${i}`}>
                <td>
                  <Skeleton width="80%" height={16} />
                </td>
                <td>
                  <Skeleton width="60%" height={16} />
                </td>
                <td>
                  <Skeleton width="100px" height={16} />
                </td>
                <td>
                  <Skeleton width="40px" height={16} />
                </td>
                <td>
                  <Skeleton width="40px" height={16} />
                </td>
                <td>
                  <Skeleton width="120px" height={16} />
                </td>
                <td />
              </tr>
            ))
          ) : songs.length === 0 ? (
            <tr>
              <td colSpan={7} className={styles.empty}>
                No songs found.
              </td>
            </tr>
          ) : (
            songs.map((s) => {
              const genreNames = (s.genres ?? []).map((g) => g.name);
              return (
                <tr key={s.id}>
                  <td>{s.title}</td>
                  <td>{s.artist}</td>
                  <td className={styles.ytId}>{s.youtube_id}</td>
                  <td className={styles.startTime}>
                    {s.start_time > 0 ? `${s.start_time}s` : "—"}
                  </td>
                  <td className={styles.startTime}>
                    {s.release_year != null ? s.release_year : "—"}
                  </td>
                  <td>
                    <div className={styles.genreList}>
                      {genreNames.length === 0 ? (
                        <span className={styles.startTime}>—</span>
                      ) : (
                        genreNames.map((name) => (
                          <span key={name} className={styles.genreTag}>
                            {name}
                          </span>
                        ))
                      )}
                    </div>
                  </td>
                  <td>
                    <div className={styles.rowActions}>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => onEdit(s)}
                        disabled={busy}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger"
                        onClick={() => onDelete(s.id)}
                        disabled={busy}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
