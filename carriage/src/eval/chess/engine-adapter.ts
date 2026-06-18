/**
 * The seam between the ChessOracle and a concrete chess engine. Decouples the Oracle from
 * any engine protocol (one-shot CLI, UCI, in-process, …). `perft` rejects if the engine
 * cannot be run/built (→ the convergence loop treats that as "unmeasurable → escalate").
 */
export interface EngineAdapter {
  perft(depth: number, fen: string): Promise<number>
}
