import blessed, { type Widgets } from 'blessed';
import chalk from 'chalk';

import { type Domain as ScenarioDomain } from '@reatiler/saga-kernel';

import { type ExecutionRow } from './state';

type LogLevel = 'info' | 'warning' | 'error';

type Renderer = {
  screen: Widgets.Screen;
  renderExecutions: (rows: ExecutionRow[]) => void;
  appendLogLine: (line: string) => void;
  pushStatusMessage: (message: string, level: LogLevel) => void;
  destroy: () => void;
};

const MAX_LOG_LINES = 50;

const STATUS_COLORS: Array<{ matcher: (status: string) => boolean; formatter: (text: string) => string }> = [
  { matcher: (status) => status === '-' || status.length === 0, formatter: chalk.gray },
  { matcher: (status) => status.includes('FAIL') || status.includes('ERROR'), formatter: chalk.red },
  { matcher: (status) => status.includes('CANCEL') || status.includes('REFUND'), formatter: chalk.yellow },
  { matcher: (status) => status.includes('CONFIRM') || status.includes('CAPTURE'), formatter: chalk.green },
  { matcher: (status) => status.includes('AUTHOR'), formatter: chalk.cyan },
  { matcher: (status) => status.includes('RESERV'), formatter: chalk.blue },
  { matcher: (status) => status.includes('PLACE'), formatter: chalk.magenta }
];

function colorizeStatus(status: string, finished: boolean): string {
  const normalized = status.toUpperCase();

  if (finished) {
    return chalk.gray(status);
  }

  const match = STATUS_COLORS.find(({ matcher }) => matcher(normalized));
  const formatter = match?.formatter ?? chalk.white;
  return formatter(status);
}

function buildHeader(domains: ScenarioDomain[]): string[] {
  return [chalk.bold('Trace ID'), ...domains.map((domain) => chalk.bold(domain.id.toUpperCase()))];
}

function formatRow(row: ExecutionRow, domains: ScenarioDomain[]): string[] {
  const traceCell = row.finished ? chalk.gray(row.traceId) : chalk.white(row.traceId);

  const domainCells = domains.map((domain) => {
    const status = row.states[domain.id] ?? '-';
    return colorizeStatus(status, row.finished);
  });

  return [traceCell, ...domainCells];
}

export function createRenderer(
  scenarioName: string,
  domains: ScenarioDomain[]
): Renderer {
  const screen = blessed.screen({ smartCSR: true });
  screen.title = `Reatiler Workflow — ${scenarioName}`;

  blessed.box({
    parent: screen,
    top: 0,
    left: 'center',
    width: 'shrink',
    height: 1,
    content: chalk.bold(`Reatiler Workflow — ${scenarioName}`),
    tags: true
  });

  const table = blessed.listtable({
    parent: screen,
    top: 1,
    left: 0,
    width: '100%',
    height: '60%',
    border: { type: 'line' },
    label: ' Executions ',
    tags: true,
    interactive: false,
    style: {
      border: { fg: 'white' },
      header: { fg: 'white', bold: true },
      cell: { fg: 'white' }
    }
  });

  const eventLogBox = blessed.box({
    parent: screen,
    top: '61%',
    left: 0,
    width: '100%',
    height: '39%',
    border: { type: 'line' },
    label: ' Event Log ',
    style: {
      border: { fg: 'white' },
      label: { fg: 'white', bold: true }
    },
    scrollable: true,
    alwaysScroll: true,
    tags: true,
    content: chalk.gray('Waiting for events...')
  });

  const logLines: string[] = [];

  const renderExecutions = (rows: ExecutionRow[]) => {
    const header = buildHeader(domains);

    if (rows.length === 0) {
      table.setData([header, [chalk.dim('Waiting for executions...'), ...domains.map(() => chalk.dim('-'))]]);
      screen.render();
      return;
    }

    const data = [header, ...rows.map((row) => formatRow(row, domains))];
    table.setData(data);
    screen.render();
  };

  const appendLogLine = (line: string) => {
    logLines.push(line);

    if (logLines.length > MAX_LOG_LINES) {
      logLines.splice(0, logLines.length - MAX_LOG_LINES);
    }

    eventLogBox.setContent(logLines.join('\n'));
    eventLogBox.setScrollPerc(100);
    screen.render();
  };

  const pushStatusMessage = (message: string, level: LogLevel) => {
    const formatted =
      level === 'error'
        ? chalk.red(message)
        : level === 'warning'
          ? chalk.yellow(message)
          : chalk.cyan(message);

    appendLogLine(`${chalk.gray(`[${new Date().toLocaleTimeString('en-GB', { hour12: false })}]`)} ${formatted}`);
  };

  const destroy = () => {
    screen.destroy();
  };

  renderExecutions([]);

  return { screen, renderExecutions, appendLogLine, pushStatusMessage, destroy };
}

export type { Renderer };
