import React, { useEffect, useState } from "react";
import { Box, render, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import { defaultConfig, type RoutingDecision, type Tier } from "@tack/core";
import { createServices, type TackServices } from "./services";
import { useTack, type AgentStep, type Turn } from "./useTack";

const TIER_COLOR: Record<Tier, string> = {
  cheap: "green",
  mid: "yellow",
  frontier: "red",
};

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

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
      <Text bold>tack — heuristic prompt router</Text>
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
        <Text dimColor>  ^c   quit</Text>
      </Box>
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
        {"  —  ^w why · ^c quit"}
      </Text>
    </Box>
  );
}

function KeyPrompt({
  provider,
  onSubmit,
}: {
  provider: string;
  onSubmit: (key: string) => void;
}): React.JSX.Element {
  const [value, setValue] = useState("");
  return (
    <Box flexDirection="column">
      <Text color="yellow">
        no API key for "{provider}" — paste it to continue (saved for next time):
      </Text>
      <Box>
        <Text color="yellow">key › </Text>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={(v) => onSubmit(v)}
          mask="*"
        />
      </Box>
    </Box>
  );
}

export function App({ services }: { services: TackServices }): React.JSX.Element {
  const { turns, pendingKey, submit, provideKey, toggleWhy } = useTack(services);
  const [input, setInput] = useState("");
  const { exit } = useApp();

  useInput((char, key) => {
    if (key.ctrl && char === "w" && turns.length > 0) {
      toggleWhy(turns.length - 1);
    }
  });

  return (
    <Box flexDirection="column">
      {turns.length === 0 && pendingKey === null && <WelcomePanel />}
      <Transcript turns={turns} />
      {pendingKey ? (
        <KeyPrompt provider={pendingKey.provider} onSubmit={(key) => void provideKey(key)} />
      ) : (
        <Box borderStyle="round" borderColor="cyan">
          <TextInput
            value={input}
            onChange={setInput}
            onSubmit={(v) => {
              setInput("");
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
