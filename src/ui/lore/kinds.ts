import { MapPin, Shield, Sparkles, UserRound, type LucideIcon } from 'lucide-react';
import type { LoreKind } from '../../lore/extract';

/** Graph colours, after Obsidian's default dark graph: blue people, cyan places, violet groups, pink ideas. */
export const KIND_COLOUR: Record<LoreKind, string> = {
  character: '#6f9bff',
  place: '#79ecd6',
  organisation: '#8f6bff',
  term: '#eba3dc',
};

export const KIND_ICON: Record<LoreKind, LucideIcon> = {
  character: UserRound,
  place: MapPin,
  organisation: Shield,
  term: Sparkles,
};

export const KIND_LABEL: Record<LoreKind, string> = {
  character: 'Character',
  place: 'Place',
  organisation: 'Organisation',
  term: 'Term',
};
