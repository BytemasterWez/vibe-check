// Plain-language executive verdict — the two-to-four sentences a
// non-specialist (a buyer, a lender, a broker's client) reads first. It
// summarises the concrete public-record signals in everyday English and ends
// with a plain next step. It never says "safe" or "unsafe" — it states what
// the records show and what to do about it.

function mod(assessment, key) {
  return assessment.modules.find((m) => m.key === key);
}

const PRIORITY_PHRASE = {
  'Low public risk signal': 'little in the public record to flag',
  'Some review points': 'a few things worth a closer look',
  'Material due-diligence questions': 'material questions to resolve before proceeding',
  'High review priority': 'significant issues that need answers before proceeding',
  'Serious public-risk concentration; manual expert review recommended':
    'a serious concentration of public-record concerns — get expert review',
};

export function buildPlainVerdict(assessment) {
  if (!assessment.identity?.registry) {
    return `We could not confirm this aircraft's identity in the FAA registry, so no risk read could be produced. Verify the registration number.`;
  }

  const reg = assessment.registry;
  const aircraft = `${reg.YEAR_MFR ? `${reg.YEAR_MFR} ` : ''}${reg.MFR} ${reg.MODEL}`.trim();
  const priority = PRIORITY_PHRASE[assessment.band?.label] ?? 'points worth reviewing';

  // Concrete signals, in plain terms, most material first.
  const signals = [];
  const accidents = mod(assessment, 'accidents');
  const directCount = accidents?.detail?.directCount ?? 0;
  if (directCount > 0) {
    signals.push(
      `${directCount} NTSB accident/incident report${directCount > 1 ? 's' : ''} directly involving this aircraft (linked in the report)`,
    );
  }

  const enforcement = mod(assessment, 'enforcement');
  if ((enforcement?.detail?.matchCount ?? 0) > 0) {
    signals.push(`public FAA enforcement history matching the registrant's name`);
  }

  const registration = mod(assessment, 'registration');
  if (registration?.detail?.deregistrationHistoryFlag) {
    signals.push(`a prior deregistration of this tail number`);
  } else if ((registration?.detail?.ownershipChanges5yr ?? 0) >= 2) {
    signals.push(`${registration.detail.ownershipChanges5yr} ownership changes in the last five years`);
  }

  const ad = mod(assessment, 'adExposure');
  if ((ad?.detail?.applicableCount ?? 0) > 0) {
    signals.push(`${ad.detail.applicableCount} airworthiness directive${ad.detail.applicableCount > 1 ? 's' : ''} that apply to this airframe/engine`);
  }

  const maintenance = mod(assessment, 'maintenance');
  if ((maintenance?.detail?.tailSdrCount ?? 0) > 0) {
    signals.push(`${maintenance.detail.tailSdrCount} maintenance defect report${maintenance.detail.tailSdrCount > 1 ? 's' : ''} on this specific aircraft`);
  }

  // Assemble.
  let verdict = `This ${aircraft} shows ${priority}.`;
  if (signals.length > 0) {
    verdict += ` The public record includes ${joinList(signals.slice(0, 3))}.`;
  } else {
    verdict += ` Nothing specific to this aircraft surfaced in the public records we checked — which is not a clean bill of health, only an absence of public flags.`;
  }
  verdict += ` ${nextStep(assessment, directCount)}`;
  return verdict;
}

function nextStep(assessment, directCount) {
  const score = assessment.score ?? 0;
  if (score > 60) {
    return 'Resolve these before any money moves, and have an A&P/IA do a full pre-buy inspection.';
  }
  if (directCount > 0) {
    return 'Read the linked NTSB report(s) and have a mechanic confirm any accident damage was properly repaired during the pre-buy.';
  }
  if (score > 20) {
    return 'Raise these points with the seller and fold them into a standard pre-buy inspection.';
  }
  return 'Proceed with a normal pre-buy inspection; this report does not replace one.';
}

function joinList(items) {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`;
}
