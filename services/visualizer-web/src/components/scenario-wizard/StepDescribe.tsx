import React from "react";

import type {
  DraftSummary,
  ScenarioProposal,
  ScenarioProposalEvent,
} from "../../types";

type StepDescribeProps = {
  descriptionText: string;
  onDescriptionChange: (value: string) => void;
  onGenerate: () => void;
  onContinue: () => void;
  isGenerating: boolean;
  summary: DraftSummary | null;
  error: string | null;
  canContinue: boolean;
};

type ScenarioProposalLike = Partial<ScenarioProposal> & Record<string, unknown>;

type SummaryViewProps = {
  summary: DraftSummary | null;
};

export function StepDescribe({
  descriptionText,
  onDescriptionChange,
  onGenerate,
  onContinue,
  isGenerating,
  summary,
  error,
  canContinue,
}: StepDescribeProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-2">
        <label className="uppercase text-[10px] text-zinc-500">
          Descripción del escenario
        </label>
        <textarea
          value={descriptionText}
          onChange={(event) => onDescriptionChange(event.target.value)}
          placeholder="Describe el flujo de negocio que quieres modelar…"
          className="w-full min-h-[160px] font-mono text-[11px] bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-green-600"
        />
        <p className="text-[10px] text-zinc-500">
          El asistente propondrá dominios, eventos principales y una explicación de la SAGA
          resultante a partir de este texto.
        </p>
        <div className="flex flex-wrap gap-2 items-center">
          <button
            type="button"
            onClick={onGenerate}
            disabled={isGenerating}
            className="px-3 py-1.5 rounded border border-green-600 text-green-400 text-xs hover:bg-zinc-900/60 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Generar
          </button>
          <button
            type="button"
            onClick={onContinue}
            disabled={!canContinue}
            className="px-3 py-1.5 rounded border border-zinc-600 text-zinc-200 text-xs hover:bg-zinc-900/60 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Continuar
          </button>
          {isGenerating ? (
            <span className="text-[10px] text-green-400">Generando idea…</span>
          ) : null}
        </div>
        {error ? <div className="text-[10px] text-red-400">{error}</div> : null}
        {!canContinue ? (
          <div className="text-[10px] text-zinc-500">
            Genera al menos una propuesta para continuar al siguiente paso.
          </div>
        ) : null}
      </div>
      <div className="space-y-2">
        <div className="uppercase text-[10px] text-zinc-500">Idea generada</div>
        <div className="min-h-[160px] rounded border border-zinc-800 bg-zinc-900 p-3 text-[11px] text-zinc-300 overflow-auto">
          <SummaryView summary={summary} />
        </div>
      </div>
    </div>
  );
}

function SummaryView({ summary }: SummaryViewProps) {
  if (!summary) {
    return <div className="text-[11px] text-zinc-500">Describe tu escenario y pulsa “Generar”.</div>;
  }

  const proposal = asProposal(summary.currentProposal);
  const name = typeof proposal?.name === "string" ? proposal.name : null;
  const domains = Array.isArray(proposal?.domains)
    ? proposal.domains.filter((domain): domain is string => typeof domain === "string")
    : [];
  const events = Array.isArray(proposal?.events)
    ? proposal.events.filter((event): event is ScenarioProposalEvent =>
        Boolean(event) &&
        typeof event === "object" &&
        typeof (event as ScenarioProposalEvent).title === "string" &&
        typeof (event as ScenarioProposalEvent).description === "string",
      )
    : [];
  const sagaSummary =
    proposal && typeof proposal.sagaSummary === "string" ? proposal.sagaSummary : null;
  const openQuestions = Array.isArray(proposal?.openQuestions)
    ? proposal.openQuestions.filter(
        (question): question is string => typeof question === "string" && question.length > 0,
      )
    : [];
  const guidance = typeof summary.guidance === "string" ? summary.guidance : null;

  const hasStructuredInfo =
    Boolean(name) ||
    domains.length > 0 ||
    events.length > 0 ||
    Boolean(sagaSummary) ||
    openQuestions.length > 0 ||
    Boolean(guidance);

  if (!hasStructuredInfo && summary.currentProposal) {
    return (
      <pre className="whitespace-pre-wrap text-zinc-300">
        {JSON.stringify(summary.currentProposal, null, 2)}
      </pre>
    );
  }

  return (
    <div className="space-y-3">
      {name ? (
        <div>
          <div className="uppercase text-[10px] text-zinc-500">Nombre sugerido</div>
          <div className="text-zinc-100">{name}</div>
        </div>
      ) : null}
      {domains.length > 0 ? (
        <div>
          <div className="uppercase text-[10px] text-zinc-500">Dominios</div>
          <ul className="list-disc pl-4 space-y-1">
            {domains.map((domain) => (
              <li key={domain}>{domain}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {events.length > 0 ? (
        <div>
          <div className="uppercase text-[10px] text-zinc-500">Eventos principales</div>
          <ul className="space-y-1">
            {events.map((event) => (
              <li key={event.title}>
                <div className="text-zinc-100">{event.title}</div>
                <div className="text-zinc-400">{event.description}</div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {sagaSummary ? (
        <div>
          <div className="uppercase text-[10px] text-zinc-500">Explicación de la SAGA</div>
          <div className="text-zinc-200 whitespace-pre-wrap">{sagaSummary}</div>
        </div>
      ) : null}
      {openQuestions.length > 0 ? (
        <div>
          <div className="uppercase text-[10px] text-zinc-500">Preguntas abiertas</div>
          <ul className="list-disc pl-4 space-y-1">
            {openQuestions.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {guidance ? (
        <div>
          <div className="uppercase text-[10px] text-zinc-500">Notas del asistente</div>
          <div className="text-zinc-200 whitespace-pre-wrap">{guidance}</div>
        </div>
      ) : null}
      {!hasStructuredInfo ? (
        <div className="text-zinc-400">Sin detalles suficientes en la respuesta.</div>
      ) : null}
    </div>
  );
}

function asProposal(value: unknown): ScenarioProposalLike | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  return value as ScenarioProposalLike;
}
