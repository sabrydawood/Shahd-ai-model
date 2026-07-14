// Serve the interactive Foundry control panel: a clear 3-stage pipeline — (1) COLLECT DATA into
// Postgres, (2) TRAIN the model on that data (a subprocess, so it never blocks the dashboard and can
// run alongside collection), (3) CHAT to test the trained model. Reads store + token from .env
// (Bun): Postgres when DATABASE_URL is set. The trained checkpoint lives in Postgres; after a Train
// run finishes it is hot-reloaded into the chat model with no restart.
//   bun run foundry:dashboard      # then open http://localhost:8090

import { StartDashboard, IngestFromWeb, CreateGitHubRepoProvider, CreateLocalRepoProvider } from "../Foundry/FoundryBarrel.ts";
import type { LearnFn, WebProvider, RepoIngestInfo, LearnEvent, TrainFn, TrainSettings, TrainEvent } from "../Foundry/FoundryBarrel.ts";
import type { ChatStore } from "../Foundry/ChatStore.ts";
import { PostgresChatStore } from "../Foundry/PostgresChatStore.ts";
import { InMemoryChatStore } from "../Foundry/InMemoryChatStore.ts";
import { ChatService } from "../Foundry/ChatService.ts";
import type { ChatStreamFn } from "../Foundry/ChatService.ts";
import { DescribeModel } from "../Foundry/ModelInfo.ts";
import type { ModelInfo } from "../Foundry/ModelInfo.ts";
import { PostgresCheckpointStore } from "../Foundry/PostgresCheckpointStore.ts";
import { LoadRunnableModel, LoadRunnableModelFrom } from "../Brain/Checkpoint/LoadRunnableModel.ts";
import type { RunnableModel } from "../Brain/Checkpoint/LoadRunnableModel.ts";
import { GuardedGenerateStream } from "../Brain/Safety/GuardedGenerate.ts";
import { RenderMessages } from "../Brain/Serving/RenderChat.ts";
import { DefaultSampling } from "../Brain/Sampling/Sampler.ts";
import { SeededRng } from "../Brain/Random/SeededRng.ts";
import { ResolveStore, GitHubToken } from "./FoundryEnv.ts";
import { ReadArg } from "./ScriptArgs.ts";
import { existsSync } from "node:fs";

const { Store, Kind } = ResolveStore();
const DbUrl = process.env["DATABASE_URL"];
const CkptName = process.env["FOUNDRY_CHECKPOINT_NAME"] ?? "foundry";

// Mutable model state — swapped in place when a training run finishes (no restart).
type ModelState = { Runnable: RunnableModel | null; Info: ModelInfo | null; Source: string };
const ModelHolder: ModelState = { Runnable: null, Info: null, Source: "none" };

// Load the chat model: Postgres checkpoint first (durable/synced), then a local file fallback.
async function ReloadModel(): Promise<void> {
  if (DbUrl !== undefined && DbUrl !== "") {
    try {
      const CkptStore = new PostgresCheckpointStore(DbUrl);
      const Ckpt = await CkptStore.Load(CkptName);
      await CkptStore.Close();
      if (Ckpt !== null) {
        ModelHolder.Runnable = LoadRunnableModelFrom(Ckpt);
        ModelHolder.Info = DescribeModel(ModelHolder.Runnable.Model);
        ModelHolder.Source = `postgres:${CkptName}`;
        return;
      }
    } catch {
      // fall through to file
    }
  }
  const FilePath = process.env["FOUNDRY_CHECKPOINT"] ?? ReadArg("--Checkpoint=", "Checkpoints/Foundry.ckpt");
  if (existsSync(FilePath)) {
    ModelHolder.Runnable = LoadRunnableModel(FilePath);
    ModelHolder.Info = DescribeModel(ModelHolder.Runnable.Model);
    ModelHolder.Source = `file:${FilePath}`;
    return;
  }
  ModelHolder.Runnable = null;
  ModelHolder.Info = null;
  ModelHolder.Source = "none";
}

// Chat generation reads the CURRENT model from the holder, so a post-training reload takes effect
// immediately. Logs each inference to the console so testing the model in the dashboard is observable.
let Counter = 0;
const Stream: ChatStreamFn = async (Messages, Opts, OnDelta) => {
  const Loaded = ModelHolder.Runnable;
  if (Loaded === null) throw new Error("no trained model yet — collect data, then press Train Model");
  const { Model, Tokenizer, Config } = Loaded;
  const Prompt = RenderMessages(Messages.map((M) => ({ role: M.Role, content: M.Content })));
  const LastMsg = (Messages[Messages.length - 1]?.Content ?? "").slice(0, 70).replace(/\s+/g, " ");
  const T0 = Date.now();
  let Chars = 0;
  let Chunks = 0;
  console.log(`[chat] ▶ turns=${Messages.length} temp=${Opts.Temperature} maxTok=${Opts.MaxTokens} · "${LastMsg}"`);
  const Rng = new SeededRng(Config.Training.Seed + Counter++);
  const Reply = await GuardedGenerateStream(
    Model, Tokenizer, Prompt, Opts.MaxTokens, { ...DefaultSampling, Temperature: Opts.Temperature }, Rng, Config,
    (Delta) => {
      Chars += Delta.length;
      Chunks++;
      OnDelta(Delta);
    },
    Opts.ShouldStop,
  );
  const Ms = Date.now() - T0;
  console.log(`[chat] ✓ ${Chars} chars / ${Chunks} tokens in ${Ms}ms (${Ms > 0 ? Math.round(Chars / (Ms / 1000)) : 0} ch/s) · "${Reply.slice(0, 70).replace(/\s+/g, " ")}"`);
  return Reply;
};

const Chats: ChatStore = DbUrl !== undefined && DbUrl !== "" ? new PostgresChatStore(DbUrl) : new InMemoryChatStore();
const Chat = new ChatService(Chats, Stream);

// STAGE 1 — Collect data (the provider-backed Learn runner).
const Learn: LearnFn = async (Settings, OnEvent) => {
  const Learned = new Set(Settings.SkipLearned ? await Store.Sources() : []);
  const Skip = (Repo: string): boolean => Learned.has(Repo);
  const OnRepo = (Info: RepoIngestInfo): void => {
    const Event: LearnEvent = { kind: "repo", repo: Info.Repo, level: Info.Assessment.Level, files: Info.Assessment.FileCount, bytes: Info.Assessment.TotalBytes, ingested: Info.Ingested, reason: Info.Reason ?? null };
    OnEvent(Event);
  };
  const Providers: WebProvider[] = [];
  if (Settings.Source !== "local") {
    Providers.push(CreateGitHubRepoProvider({ Token: GitHubToken(), MinLevel: Settings.MinLevel, MaxFilesPerRepo: Settings.MaxFilesPerRepo, MaxBytesPerRepo: Settings.MaxBytesPerRepo, MaxContentBytesPerRepo: Settings.MaxContentBytes, SkipRepo: Skip, OnRepo }));
  }
  if (Settings.Source !== "github") {
    Providers.push(CreateLocalRepoProvider({ Roots: Settings.Repos, MinLevel: Settings.MinLevel, MaxFiles: Settings.MaxFilesPerRepo, MaxBytes: Settings.MaxBytesPerRepo, MaxContentBytes: Settings.MaxContentBytes, SkipRepo: Skip, OnRepo }));
  }
  const OnProgress = (Repo: string, Done: number, Total: number): void => {
    const Stride = Math.max(1, Math.floor(Total / 50));
    if (Done % Stride === 0 || Done === Total) OnEvent({ kind: "repo-progress", repo: Repo, filesDone: Done, filesTotal: Total });
  };
  const Stats = await IngestFromWeb(Providers, [Settings.Query], Store, new Date().toISOString(), Settings.MaxRepos, 256, OnProgress);
  OnEvent({ kind: "done", ingested: Stats.Ingested });
};

// STAGE 2 — Train the model on the collected corpus (subprocess: never blocks the dashboard, can run
// alongside collection). Parses the trainer's stdout into progress/info events; saves to Postgres.
const ParseTrainLine = (Line: string, Settings: TrainSettings, OnEvent: (Event: TrainEvent) => void): void => {
  if (Line.startsWith("{")) {
    try {
      const J = JSON.parse(Line) as { Step?: number; TrainLoss?: number; ValLoss?: number };
      if (typeof J.Step === "number") {
        OnEvent({ kind: "train-progress", step: J.Step, steps: Settings.Steps, trainLoss: J.TrainLoss ?? 0, valLoss: J.ValLoss ?? 0 });
        return;
      }
    } catch {
      // not a progress line
    }
  }
  OnEvent({ kind: "train-info", text: Line });
};

const Train: TrainFn = async (Settings, OnEvent) => {
  const Proc = Bun.spawn(
    ["bun", "run", "Scripts/TrainOnFoundry.ts", `--Steps=${Settings.Steps}`, `--CorpusMb=${Settings.CorpusMb}`, `--EmbedDim=${Settings.EmbedDim}`, `--Layers=${Settings.NumLayers}`, `--Name=${CkptName}`, "--Save=Checkpoints/Foundry.ckpt"],
    { stdout: "pipe", stderr: "pipe", env: { ...process.env } },
  );
  const Decoder = new TextDecoder();
  let Buf = "";
  const Reader = Proc.stdout.getReader();
  for (;;) {
    const { done: Done, value: Value } = await Reader.read();
    if (Done) break;
    if (Value !== undefined) {
      Buf += Decoder.decode(Value, { stream: true });
      let Idx = Buf.indexOf("\n");
      while (Idx >= 0) {
        const Line = Buf.slice(0, Idx).trim();
        Buf = Buf.slice(Idx + 1);
        if (Line !== "") ParseTrainLine(Line, Settings, OnEvent);
        Idx = Buf.indexOf("\n");
      }
    }
  }
  const Code = await Proc.exited;
  if (Code === 0) OnEvent({ kind: "train-done", savedTo: `postgres:${CkptName}` });
  else OnEvent({ kind: "train-error", message: `trainer exited with code ${Code} (see server console)` });
};

await ReloadModel();

const Port = Number(ReadArg("--Port=", "8090"));
StartDashboard(Store, Port, Learn, {
  Chat,
  GetModel: () => ModelHolder.Info,
  Train,
  OnTrained: ReloadModel,
});
console.log(`Foundry control panel: http://localhost:${Port}  (store=${Kind}, ${await Store.Count()} docs, GitHub token: ${GitHubToken() ? "yes" : "no"})`);
console.log(`  chat model: ${ModelHolder.Source} (memory: ${DbUrl ? "postgres" : "in-memory"})`);
