import type { ReactNode } from 'react';
import type { PlayerInfo } from '@kg/shared';

const AVATAR_COLORS = ['#ff5f8f', '#ffb020', '#3ee0b0', '#4dc4ff', '#a98bff', '#ff8a4c', '#7ce35f', '#f06bd9'];
/** Stable colour per player id. */
export function avatarColor(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}

type Props = {
  player: PlayerInfo;
  isHost: boolean;
  isMe: boolean;
  /** Status marks shown before the name (drawing, found, answered…). */
  marks?: ReactNode;
  /** Right-hand value, e.g. the score. */
  aside?: ReactNode;
};

/** One `.player-list` row: avatar, crown, marks, name, (toi)/(absent). */
export function PlayerRow({ player: p, isHost, isMe, marks, aside }: Props) {
  return (
    <li className={`${p.connected ? '' : 'away'}${isMe ? ' me' : ''}`}>
      <span className="avatar" style={{ background: avatarColor(p.id) }} aria-hidden="true">{[...p.name][0]?.toUpperCase()}</span>
      <span className="player-name">
        {isHost && <span className="crown" title="Hôte" aria-label="Hôte">♛</span>}
        {marks}
        {p.name}
        {isMe && <span className="you"> (toi)</span>}
        {!p.connected && <span className="you"> (absent)</span>}
      </span>
      {aside}
    </li>
  );
}
