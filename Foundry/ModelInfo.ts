// Describe the LOADED chat model for the dashboard: its architecture and a per-component parameter
// breakdown (token/position embeddings, attention, MLP, layernorms, LM head) with percentages. This
// reflects the actual checkpoint in memory — the earlier panel showed the DEFAULT config's numbers,
// which is why it read wrong. Pure over the model object; no I/O.

import type { Shahd } from "../Brain/Nn/Shahd.ts";
import type { Tensor } from "../Brain/Tensor/Tensor.ts";

export type ParamGroup = { Label: string; Params: number; Pct: number };

export type ModelInfo = {
  EmbedDim: number;
  NumLayers: number;
  NumHeads: number;
  BlockSize: number;
  VocabSize: number;
  PositionScheme: string;
  NormKind: string;
  MlpKind: string;
  WeightTying: boolean;
  TotalParams: number;
  Groups: ParamGroup[];
};

const SumSize = (Params: Tensor[]): number => Params.reduce((Acc, P) => Acc + P.Size, 0);

export function DescribeModel(Model: Shahd): ModelInfo {
  const M = Model.Config.Model;
  const TokenEmb = Model.Embedding.Wte.Size;
  const PosEmb = Model.Embedding.Wpe !== null ? Model.Embedding.Wpe.Size : 0;

  let Attn = 0;
  let Mlp = 0;
  let Norms = SumSize(Model.LnFinal.Parameters());
  for (const B of Model.Blocks) {
    Attn += SumSize(B.Attn.Parameters());
    Mlp += SumSize(B.Mlp.Parameters());
    Norms += SumSize(B.Ln1.Parameters()) + SumSize(B.Ln2.Parameters());
  }
  const Head = (Model.LmHead !== null ? Model.LmHead.Size : 0) + Model.LmHeadBias.Size;
  const Total = SumSize(Model.Parameters());

  const Raw: { Label: string; Params: number }[] = [
    { Label: Model.WeightTying ? "Token embeddings (tied to LM head)" : "Token embeddings", Params: TokenEmb },
    { Label: "Position embeddings", Params: PosEmb },
    { Label: "Attention", Params: Attn },
    { Label: "MLP", Params: Mlp },
    { Label: "LayerNorms", Params: Norms },
    { Label: "LM head", Params: Head },
  ];
  const Groups = Raw.filter((G) => G.Params > 0).map((G) => ({ ...G, Pct: Total > 0 ? (G.Params / Total) * 100 : 0 }));

  return {
    EmbedDim: M.EmbedDim,
    NumLayers: M.NumLayers,
    NumHeads: M.NumHeads,
    BlockSize: M.BlockSize,
    VocabSize: M.VocabSize,
    PositionScheme: M.PositionScheme,
    NormKind: M.NormKind,
    MlpKind: M.MlpKind,
    WeightTying: Model.WeightTying,
    TotalParams: Total,
    Groups,
  };
}
