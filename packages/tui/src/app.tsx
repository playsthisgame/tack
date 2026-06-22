import React, { useEffect, useRef, useState } from "react";
import { Box, render, Text, useApp, useInput } from "ink";
import {
  defaultConfig,
  type Advisory,
  type DeviceCodeResult,
  type RoutingDecision,
  type Tier,
} from "@tack/core";
import {
  createServices,
  type ConnectResult,
  type CopilotConnectCallbacks,
  type ProviderChoice,
  type SetTierModelResult,
  type TackServices,
} from "./services";
import { useTack, type AgentStep, type Turn } from "./useTack";

const TIER_COLOR: Record<Tier, string> = {
  cheap: "green",
  mid: "yellow",
  frontier: "red",
};

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const TACK_ART = [
  "████████   ██████    ██████   ██   ██",
  "   ██     ██    ██  ██        ██  ██ ",
  "   ██     ████████  ██        █████  ",
  "   ██     ██    ██  ██        ██  ██ ",
  "   ██     ██    ██   ██████   ██   ██",
];

function Spinner(): React.JSX.Element {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 80);
    return () => clearInterval(id);
  }, []);
  return <Text color="cyan">{SPINNER_FRAMES[frame]}</Text>;
}

function ModelBadge({ tier, model }: { tier: Tier; model: string }): React.JSX.Element {
  return (
    <Text>
      <Text color={TIER_COLOR[tier]}>{tier}</Text>
      <Text dimColor> · {model}</Text>
    </Text>
  );
}

function Why({ decision }: { decision: RoutingDecision }): React.JSX.Element {
  return (
    <Box flexDirection="column" marginLeft={2}>
      <Text dimColor>why (score {decision.score}):</Text>
      {decision.contributions.length === 0 ? (
        <Text dimColor> (no signals fired — baseline cheap)</Text>
      ) : (
        decision.contributions.map((c, i) => (
          <Text key={i} dimColor>
            {" "}
            {c.weight >= 0 ? "+" : ""}
            {c.weight} {c.detail}
          </Text>
        ))
      )}
    </Box>
  );
}

function ToolCallView({ toolName, args, result }: { toolName: string; args: unknown; result?: string }): React.JSX.Element {
  const argStr = JSON.stringify(args);
  const brief = argStr.length > 80 ? argStr.slice(0, 80) + "…" : argStr;
  return (
    <Box flexDirection="column" marginLeft={2}>
      <Text dimColor>
        <Text color="cyan">⚙ </Text>
        {toolName}({brief})
      </Text>
      {result !== undefined && (
        <Text dimColor>
          {"  ↳ "}
          {result.slice(0, 120).replace(/\n/g, "↵")}
          {result.length > 120 ? "…" : ""}
        </Text>
      )}
    </Box>
  );
}

function StepView({ step, showWhy, isLast, inFlight }: {
  step: AgentStep;
  showWhy: boolean;
  isLast: boolean;
  inFlight: boolean;
}): React.JSX.Element {
  const responseText = step.response;
  return (
    <Box flexDirection="column">
      <Box marginLeft={2}>
        <ModelBadge tier={step.decision.tier} model={step.model} />
      </Box>
      {showWhy && <Why decision={step.decision} />}
      {step.toolCalls.map((tc) => (
        <ToolCallView key={tc.id} toolName={tc.toolName} args={tc.args} result={tc.result} />
      ))}
      {isLast && inFlight && step.toolCalls.length === 0 && responseText.length === 0 && (
        <Box marginLeft={2}>
          <Spinner />
        </Box>
      )}
      {responseText.length > 0 && (
        <Box marginLeft={2}>
          <Text>{responseText}</Text>
        </Box>
      )}
    </Box>
  );
}

export function TurnView({ turn }: { turn: Turn }): React.JSX.Element {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text>
        <Text color="cyan">› </Text>
        {turn.prompt}
      </Text>
      {turn.steps.map((step, i) => (
        <StepView
          key={i}
          step={step}
          showWhy={turn.showWhy}
          isLast={i === turn.steps.length - 1}
          inFlight={turn.inFlight}
        />
      ))}
      {turn.inFlight && turn.steps.length === 0 && (
        <Box marginLeft={2}>
          <Spinner />
        </Box>
      )}
      {turn.error && (
        <Box marginLeft={2}>
          <Text color="red">error: {turn.error}</Text>
        </Box>
      )}
    </Box>
  );
}

function Transcript({ turns }: { turns: Turn[] }): React.JSX.Element {
  return (
    <Box flexDirection="column">
      {turns.map((turn, i) => (
        <TurnView key={i} turn={turn} />
      ))}
    </Box>
  );
}

function WelcomePanel(): React.JSX.Element {
  const tiers = Object.entries(defaultConfig.tierModels) as [Tier, string][];
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box flexDirection="column">
        {TACK_ART.map((line, i) => (
          <Text key={i} color="cyan" bold>
            {line}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>tier routing:</Text>
        {tiers.map(([tier, model]) => (
          <Box key={tier} marginLeft={2}>
            <Text color={TIER_COLOR[tier]}>{tier.padEnd(10)}</Text>
            <Text dimColor>{model}</Text>
          </Box>
        ))}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>keys:</Text>
        <Text dimColor>  ^w   toggle routing rationale for last turn</Text>
        <Text dimColor>  ^t   configure tier models</Text>
        <Text dimColor>  /connect  choose your model provider</Text>
        <Text dimColor>  ^c   quit (or type "exit")</Text>
      </Box>
    </Box>
  );
}

function AdvisoryPanel({ advisory }: { advisory: Advisory }): React.JSX.Element {
  const blocking = advisory.kind === "compaction-required";
  return (
    <Box
      flexDirection="column"
      marginBottom={1}
      borderStyle="round"
      borderColor={blocking ? "red" : "yellow"}
      paddingX={1}
    >
      <Text color={blocking ? "red" : "yellow"} bold>
        {blocking ? "⚠ compaction required" : "ℹ compaction advisory"}
      </Text>
      <Text>{advisory.message}</Text>
      <Text dimColor>^d to dismiss</Text>
    </Box>
  );
}

function StatusBar({ turns, pending }: { turns: Turn[]; pending: boolean }): React.JSX.Element {
  const last = turns[turns.length - 1];
  const lastStep = last?.steps[last.steps.length - 1];
  return (
    <Box marginTop={1}>
      <Text dimColor>
        {pending
          ? "awaiting API key"
          : lastStep
            ? `last: ${lastStep.decision.tier} · ${lastStep.model}`
            : "type a prompt to route it"}
        {"  —  ^w why · ^t models · /connect provider · ^c quit"}
      </Text>
    </Box>
  );
}

/**
 * A controlled single-line text input. We own key handling instead of using
 * `ink-text-input` because Ink dispatches every `useInput` handler for each key
 * (there is no way to consume an event), and `ink-text-input` inserts any
 * `ctrl`/`meta`+letter it doesn't special-case — so e.g. `^w` leaks a literal
 * "w" into the field. Here we explicitly ignore modifier combos, so app-level
 * shortcuts like `^w` never reach the buffer regardless of handler ordering.
 */
function PromptInput({
  value,
  onChange,
  onSubmit,
  onHistoryPrev,
  onHistoryNext,
  placeholder,
  mask,
  focus = true,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  /** Up arrow — used by the main prompt to recall an older history entry. */
  onHistoryPrev?: () => void;
  /** Down arrow — recall a newer entry / restore the in-progress draft. */
  onHistoryNext?: () => void;
  placeholder?: string;
  mask?: string;
  focus?: boolean;
}): React.JSX.Element {
  const [cursor, setCursor] = useState(value.length);
  const pos = Math.min(cursor, value.length);

  // The value is controlled, so it can change without a keypress (cleared on submit,
  // replaced on a history recall). When that happens, snap the cursor to the end so a
  // recalled prompt is ready to edit/submit. `commit` tags edits we originate so the
  // effect can tell them apart from external changes.
  const lastEmitted = useRef(value);
  useEffect(() => {
    if (value !== lastEmitted.current) {
      lastEmitted.current = value;
      setCursor(value.length);
    }
  }, [value]);

  const commit = (next: string, cursorAt: number): void => {
    lastEmitted.current = next;
    onChange(next);
    setCursor(cursorAt);
  };

  useInput(
    (input, key) => {
      if (key.return) {
        onSubmit?.(value);
        return;
      }
      if (key.upArrow) {
        onHistoryPrev?.();
        return;
      }
      if (key.downArrow) {
        onHistoryNext?.();
        return;
      }
      // Never insert a character for a modifier combo or unhandled navigation —
      // this is exactly the `^w` → "w" leak we are fixing.
      if (key.ctrl || key.meta || key.tab || key.escape) {
        return;
      }
      if (key.leftArrow) {
        setCursor(Math.max(0, pos - 1));
        return;
      }
      if (key.rightArrow) {
        setCursor(Math.min(value.length, pos + 1));
        return;
      }
      if (key.backspace || key.delete) {
        if (pos > 0) commit(value.slice(0, pos - 1) + value.slice(pos), pos - 1);
        return;
      }
      // Printable input (a single char, or a whole string on paste).
      if (input.length > 0) {
        commit(value.slice(0, pos) + input + value.slice(pos), pos + input.length);
      }
    },
    { isActive: focus },
  );

  if (value.length === 0 && placeholder) {
    return <Text dimColor>{placeholder}</Text>;
  }

  const shown = mask ? mask.repeat(value.length) : value;
  return (
    <Text>
      {shown.slice(0, pos)}
      <Text inverse>{shown.slice(pos, pos + 1) || " "}</Text>
      {shown.slice(pos + 1)}
    </Text>
  );
}

function KeyPrompt(
  {
    provider,
    onSubmit,
  }: {
    provider: string;
    onSubmit: (key: string) => void;
  }
): React.JSX.Element {
  const [value, setValue] = useState("");
  return (
    <Box flexDirection="column">
      <Text color="yellow">
        no API key for "{provider}" — paste it to continue (saved for next time):
      </Text>
      <Box>
        <Text color="yellow">key › </Text>
        <PromptInput value={value} onChange={setValue} onSubmit={(v) => onSubmit(v)} mask="*" />
      </Box>
    </Box>
  );
}

/**
 * Modal editor for the per-tier model mapping. Reuses `PromptInput` (which ignores
 * ctrl/meta combos) so the `^t` that opens it cannot leak a character, and runs its
 * own `useInput` only for navigation (↑/↓) and dismissal (esc) — keys `PromptInput`
 * ignores, so the two handlers never collide.
 */
function ModelConfigEditor({
  models,
  onSet,
  onClose,
}: {
  models: Record<Tier, string>;
  onSet: (tier: Tier, model: string, window?: number) => SetTierModelResult;
  onClose: () => void;
}): React.JSX.Element {
  const tiers: Tier[] = ["cheap", "mid", "frontier"];
  const [sel, setSel] = useState(0);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingModel, setPendingModel] = useState<string | null>(null);
  const [windowValue, setWindowValue] = useState("");
  const tier = tiers[sel]!;

  useInput((_input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (pendingModel) return; // lock selection while entering a window
    if (key.upArrow || key.downArrow) {
      const next = (sel + (key.upArrow ? tiers.length - 1 : 1)) % tiers.length;
      setSel(next);
      setValue("");
      setError(null);
    }
  });

  const saveModel = (v: string): void => {
    const model = v.trim();
    if (!model) return; // empty submit leaves the tier unchanged
    const r = onSet(tier, model);
    if (r.ok) return onClose();
    if (r.needsWindow) {
      setPendingModel(model);
      setWindowValue("");
    }
    setError(r.error);
  };

  const saveWindow = (v: string): void => {
    const n = Number(v.trim());
    if (!Number.isFinite(n) || n <= 0) {
      setError("window must be a positive number of tokens");
      return;
    }
    const r = onSet(tier, pendingModel!, n);
    if (r.ok) return onClose();
    setError(r.error);
  };

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold>configure tier models</Text>
      <Text dimColor>↑/↓ select · type a model · enter save · esc cancel</Text>
      <Box flexDirection="column" marginTop={1}>
        {tiers.map((t, i) => (
          <Text key={t} color={i === sel ? TIER_COLOR[t] : undefined} dimColor={i !== sel}>
            {i === sel ? "› " : "  "}
            {t.padEnd(10)} {models[t]}
          </Text>
        ))}
      </Box>
      <Box marginTop={1}>
        {pendingModel ? (
          <>
            <Text color="yellow">window for {pendingModel} › </Text>
            <PromptInput value={windowValue} onChange={setWindowValue} onSubmit={saveWindow} />
          </>
        ) : (
          <>
            <Text color={TIER_COLOR[tier]}>{tier} model › </Text>
            <PromptInput value={value} onChange={setValue} onSubmit={saveModel} placeholder={models[tier]} />
          </>
        )}
      </Box>
      {error && <Text color="red">{error}</Text>}
    </Box>
  );
}

/**
 * Copilot browser sign-in. Shows the GitHub `user_code` and verification URL the
 * user must open, then spins while polling completes. No key is ever requested.
 */
function CopilotConnect({
  onConnect,
  onDone,
}: {
  onConnect: (callbacks?: CopilotConnectCallbacks) => Promise<{ ok: true } | { ok: false; error: string }>;
  onDone: () => void;
}): React.JSX.Element {
  const [device, setDevice] = useState<DeviceCodeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // run the flow exactly once
    started.current = true;
    void onConnect({ onUserCode: setDevice }).then((r) => {
      if (r.ok) onDone();
      else setError(r.error);
    });
  }, [onConnect, onDone]);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold>GitHub Copilot sign-in</Text>
      {error ? (
        <Text color="red">{error}</Text>
      ) : device ? (
        <Box flexDirection="column" marginTop={1}>
          <Text>
            Open <Text color="cyan">{device.verificationUri}</Text> and enter code:
          </Text>
          <Text bold color="yellow">
            {"  "}
            {device.userCode}
          </Text>
          <Box>
            <Spinner />
            <Text dimColor> waiting for authorization…</Text>
          </Box>
        </Box>
      ) : (
        <Box>
          <Spinner />
          <Text dimColor> starting sign-in (checking for an existing session)…</Text>
        </Box>
      )}
    </Box>
  );
}

/**
 * First-run / `/connect` provider setup. Step 1 picks a provider (↑/↓ + enter); on
 * choose, `onConnect` points all tiers at that provider and reports the auth UI to
 * show next: key providers reuse `KeyPrompt`; Copilot (`kind: "device"`) runs the
 * browser device flow via `CopilotConnect`. Its own `useInput` handles only
 * navigation, so no keystroke leaks into a field.
 */
function ProviderConnect({
  providers,
  onConnect,
  onConnectCopilot,
  onSaveKey,
  onDone,
}: {
  providers: ProviderChoice[];
  onConnect: (name: string) => ConnectResult;
  onConnectCopilot: (callbacks?: CopilotConnectCallbacks) => Promise<{ ok: true } | { ok: false; error: string }>;
  onSaveKey: (provider: string, key: string) => void;
  onDone: () => void;
}): React.JSX.Element {
  const [sel, setSel] = useState(0);
  const [keyFor, setKeyFor] = useState<{ provider: string; label: string } | null>(null);
  const [deviceFlow, setDeviceFlow] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useInput((_input, key) => {
    if (keyFor || deviceFlow) return; // the active sub-step owns input
    if (key.upArrow || key.downArrow) {
      setSel((s) => (s + (key.upArrow ? providers.length - 1 : 1)) % providers.length);
      setError(null);
    } else if (key.return) {
      const p = providers[sel];
      if (!p) return;
      const r = onConnect(p.name);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      if (r.kind === "device") setDeviceFlow(true);
      else if (r.needsKey) setKeyFor({ provider: r.provider, label: r.label });
      else onDone();
    }
  });

  if (deviceFlow) {
    return <CopilotConnect onConnect={onConnectCopilot} onDone={onDone} />;
  }

  if (keyFor) {
    return (
      <KeyPrompt
        provider={keyFor.provider}
        onSubmit={(k) => {
          if (!k.trim()) return;
          onSaveKey(keyFor.provider, k);
          onDone();
        }}
      />
    );
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold>connect a provider</Text>
      <Text dimColor>↑/↓ select · enter choose</Text>
      <Box flexDirection="column" marginTop={1}>
        {providers.map((p, i) => (
          <Text key={p.name} color={i === sel ? "cyan" : undefined} dimColor={i !== sel}>
            {i === sel ? "› " : "  "}
            {p.label}
            {p.connected ? (p.browserSignIn ? " (signed in)" : " (key set)") : ""}
          </Text>
        ))}
      </Box>
      {error && <Text color="red">{error}</Text>}
    </Box>
  );
}

export function App({ services }: { services: TackServices }): React.JSX.Element {
  const { turns, pendingKey, advisory, submit, provideKey, toggleWhy, dismissAdvisory } =
    useTack(services);
  const [input, setInput] = useState("");
  const [editing, setEditing] = useState(false);
  // Provider connection: forced on first run (no resolvable key), re-openable via /connect.
  const [connected, setConnected] = useState(() => services.isConnected());
  const [connecting, setConnecting] = useState(false);
  const setupOpen = !connected || connecting;
  const { exit } = useApp();

  // Prompt history (oldest → newest), seeded from prior sessions and appended each
  // turn. `histPos` is steps back from the live draft (0 = the draft itself), so ↑
  // recalls older prompts and ↓ walks back toward the draft — like a shell.
  const [history, setHistory] = useState<string[]>(() => services.history());
  const [histPos, setHistPos] = useState(0);
  const [draft, setDraft] = useState("");

  const historyPrev = (): void => {
    if (history.length === 0) return;
    if (histPos === 0) setDraft(input); // entering history — remember the draft
    const next = Math.min(histPos + 1, history.length);
    setHistPos(next);
    setInput(history[history.length - next]!);
  };

  const historyNext = (): void => {
    if (histPos === 0) return;
    const next = histPos - 1;
    setHistPos(next);
    setInput(next === 0 ? draft : history[history.length - next]!);
  };

  // App-level shortcuts. `PromptInput` ignores ctrl/meta combos, so these never
  // double as typed characters. `^t` opens the tier-model editor (`^m` is unusable —
  // terminals deliver Ctrl-M as Enter).
  useInput((char, key) => {
    if (setupOpen) return; // provider setup owns the screen
    if (key.ctrl && char === "t") {
      setEditing((e) => !e);
    } else if (key.ctrl && char === "w" && turns.length > 0) {
      toggleWhy(turns.length - 1);
    } else if (key.ctrl && char === "d" && advisory) {
      dismissAdvisory();
    }
  });

  return (
    <Box flexDirection="column">
      {turns.length === 0 && pendingKey === null && !editing && !setupOpen && <WelcomePanel />}
      <Transcript turns={turns} />
      {advisory && <AdvisoryPanel advisory={advisory} />}
      {setupOpen ? (
        <ProviderConnect
          providers={services.providers()}
          onConnect={services.connectProvider}
          onConnectCopilot={services.connectCopilot}
          onSaveKey={(provider, key) => services.saveKey(provider, key, true)}
          onDone={() => {
            setConnected(true);
            setConnecting(false);
          }}
        />
      ) : pendingKey ? (
        <KeyPrompt provider={pendingKey.provider} onSubmit={(key) => void provideKey(key)} />
      ) : editing ? (
        <ModelConfigEditor
          models={services.tierModels()}
          onSet={services.setTierModel}
          onClose={() => setEditing(false)}
        />
      ) : (
        <Box borderStyle="round" borderColor="cyan">
          <PromptInput
            value={input}
            onChange={setInput}
            onHistoryPrev={historyPrev}
            onHistoryNext={historyNext}
            onSubmit={(v) => {
              setInput("");
              setHistPos(0);
              setDraft("");
              // Typing "exit" quits, same as ^c.
              if (v.trim().toLowerCase() === "exit") {
                exit();
                return;
              }
              // `/connect` re-opens the provider setup.
              if (v.trim() === "/connect") {
                setConnecting(true);
                return;
              }
              const p = v.trim();
              // Append to history unless it repeats the most recent entry.
              if (p) setHistory((h) => (h[h.length - 1] === p ? h : [...h, p]));
              void submit(v);
            }}
            placeholder="ask anything…"
          />
        </Box>
      )}
      <StatusBar turns={turns} pending={pendingKey !== null} />
    </Box>
  );
}

export function runTui(services: TackServices = createServices()) {
  return render(<App services={services} />);
}
