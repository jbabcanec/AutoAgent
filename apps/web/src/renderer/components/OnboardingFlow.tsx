import { useMemo, useState } from "react";
import { CheckCircle2, Zap } from "lucide-react";
import type { ProviderItem } from "../../lib/types.js";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { TrialTaskChat } from "./TrialTaskChat";
import { TrialTaskRepo } from "./TrialTaskRepo";

const PROVIDER_PRESETS = [
  {
    id: "openai-default",
    displayName: "OpenAI",
    kind: "openai-compatible" as const,
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "o3", "o4-mini"],
  },
  {
    id: "anthropic-default",
    displayName: "Anthropic",
    kind: "anthropic-compatible" as const,
    baseUrl: "https://api.anthropic.com/v1",
    models: ["claude-sonnet-4-20250514", "claude-opus-4-20250514", "claude-haiku-4-20250414"],
  },
  {
    id: "openrouter-default",
    displayName: "OpenRouter",
    kind: "openai-compatible" as const,
    baseUrl: "https://openrouter.ai/api/v1",
    models: ["anthropic/claude-sonnet-4", "openai/gpt-4o", "google/gemini-2.5-pro"],
  },
  {
    id: "ollama-local",
    displayName: "Ollama (Local)",
    kind: "openai-compatible" as const,
    baseUrl: "http://localhost:11434/v1",
    models: ["llama3.1", "codellama", "mistral", "deepseek-coder-v2"],
  },
];

interface ProviderDraft {
  id: string;
  displayName: string;
  kind: "openai-compatible" | "anthropic-compatible" | "custom";
  baseUrl: string;
  defaultModel: string;
  apiKey: string;
}

export function OnboardingFlow({
  providers,
  onSaveProviderAndKey,
  onRunChatTrial,
  onRunRepoTrial,
  onComplete
}: {
  providers: ProviderItem[];
  onSaveProviderAndKey: (draft: ProviderDraft) => Promise<ProviderItem>;
  onRunChatTrial: (providerId: string, prompt: string) => Promise<string>;
  onRunRepoTrial: (providerId: string, input: { directory: string; objective: string }) => Promise<string>;
  onComplete: (trialCompleted: "chat" | "repo" | "both") => Promise<void>;
}): React.JSX.Element {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [saving, setSaving] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [providerId, setProviderId] = useState<string>("openai-default");
  const [chatCompleted, setChatCompleted] = useState(false);
  const [repoCompleted, setRepoCompleted] = useState(false);
  const [selectedPresetIndex, setSelectedPresetIndex] = useState(0);
  const [draft, setDraft] = useState<ProviderDraft>({
    id: PROVIDER_PRESETS[0]!.id,
    displayName: PROVIDER_PRESETS[0]!.displayName,
    kind: PROVIDER_PRESETS[0]!.kind,
    baseUrl: PROVIDER_PRESETS[0]!.baseUrl,
    defaultModel: PROVIDER_PRESETS[0]!.models[0]!,
    apiKey: ""
  });

  const knownProviders = useMemo(() => new Set(providers.map((provider) => provider.id)), [providers]);
  const currentPreset = PROVIDER_PRESETS[selectedPresetIndex]!;

  function selectPreset(index: number): void {
    const preset = PROVIDER_PRESETS[index]!;
    setSelectedPresetIndex(index);
    setDraft((prev) => ({
      ...prev,
      id: preset.id,
      displayName: preset.displayName,
      kind: preset.kind,
      baseUrl: preset.baseUrl,
      defaultModel: preset.models[0]!,
    }));
  }

  async function saveProvider(): Promise<void> {
    setSaving(true);
    setError("");
    try {
      const provider = await onSaveProviderAndKey(draft);
      setProviderId(provider.id);
      // Quick connection test — send a tiny prompt to verify the key works
      try {
        await onRunChatTrial(provider.id, "Reply with OK.");
      } catch (testErr) {
        setError(`Key saved but connection failed: ${testErr instanceof Error ? testErr.message : "Unknown error"}. Check your key and try again.`);
        setSaving(false);
        return;
      }
      setConnected(true);
      setSaving(false);
      // Brief green check, then advance
      setTimeout(() => setStep(2), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save provider key.");
    } finally {
      setSaving(false);
    }
  }

  async function completeOnboarding(): Promise<void> {
    const trialCompleted = chatCompleted && repoCompleted ? "both" : chatCompleted ? "chat" : "repo";
    await onComplete(trialCompleted);
  }

  return (
    <div className="min-h-full flex items-center justify-center p-8 bg-gradient-to-b from-muted/50">
      <Card className="w-full max-w-2xl">
        <CardHeader className="text-center pb-2">
          <div className="flex justify-center mb-3">
            <div className="h-12 w-12 rounded-xl bg-primary flex items-center justify-center">
              <Zap className="h-6 w-6 text-primary-foreground" />
            </div>
          </div>
          <CardTitle className="text-2xl">Welcome to AutoAgent</CardTitle>
          <CardDescription>Connect an AI provider to get started.</CardDescription>
        </CardHeader>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 px-6 pb-4">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex items-center gap-2">
              <div
                className={`h-2 w-8 rounded-full transition-colors ${
                  s <= step ? "bg-primary" : "bg-muted"
                }`}
              />
            </div>
          ))}
        </div>

        <CardContent className="space-y-4">
          {step === 1 ? (
            <div className="space-y-3">
              <h3 className="text-base font-semibold">Choose your AI provider</h3>
              <div className="space-y-2">
                <Label>Provider</Label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={selectedPresetIndex}
                  onChange={(e) => selectPreset(Number(e.target.value))}
                >
                  {PROVIDER_PRESETS.map((preset, i) => (
                    <option value={i} key={preset.id}>{preset.displayName}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Model</Label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={draft.defaultModel}
                  onChange={(e) => setDraft((prev) => ({ ...prev, defaultModel: e.target.value }))}
                >
                  {currentPreset.models.map((model) => (
                    <option value={model} key={model}>{model}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>API Key</Label>
                <Input
                  type="password"
                  value={draft.apiKey}
                  onChange={(event) => setDraft((prev) => ({ ...prev, apiKey: event.target.value }))}
                  placeholder={currentPreset.kind === "anthropic-compatible" ? "sk-ant-..." : "sk-..."}
                />
              </div>
              {error ? (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
              {connected ? (
                <div className="flex items-center justify-center gap-2 py-2 text-emerald-600 font-medium">
                  <CheckCircle2 className="h-5 w-5" />
                  Connected
                </div>
              ) : (
                <Button className="w-full" disabled={saving || !draft.apiKey.trim()} onClick={() => void saveProvider()}>
                  {saving ? "Connecting..." : "Connect and Continue"}
                </Button>
              )}
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-4">
              <h3 className="text-base font-semibold">Try it out</h3>
              <TrialTaskChat
                onRun={async (prompt) => {
                  const output = await onRunChatTrial(providerId, prompt);
                  setChatCompleted(true);
                  return output;
                }}
              />
              <TrialTaskRepo
                onRun={async (input) => {
                  const output = await onRunRepoTrial(providerId, input);
                  setRepoCompleted(true);
                  return output;
                }}
              />
              <Button className="w-full" onClick={() => setStep(3)} disabled={!chatCompleted && !repoCompleted}>
                Continue
              </Button>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-4 text-center py-4">
              <h3 className="text-base font-semibold">You're ready</h3>
              <p className="text-sm text-muted-foreground">
                Create tasks from the dashboard and monitor everything in one place.
              </p>
              <Button className="w-full" onClick={() => void completeOnboarding()}>
                Open Dashboard
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
