export interface PerftPosition {
  name: string
  fen: string
  /** depth → known-correct perft node count */
  counts: Record<number, number>
}

/** Standard perft positions with community-verified node counts (Chess Programming Wiki). */
export const PERFT_POSITIONS: PerftPosition[] = [
  {
    name: "startpos",
    fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    counts: { 1: 20, 2: 400, 3: 8902, 4: 197281, 5: 4865609 },
  },
  {
    name: "kiwipete",
    fen: "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
    // d4 (4085603) / d5 (193690690) omitted here: expensive at runtime; add when the engine is fast enough.
    counts: { 1: 48, 2: 2039, 3: 97862 },
  },
]
