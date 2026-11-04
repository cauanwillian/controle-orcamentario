import { copyFile, constants as fsConstants, link, mkdir, mkdtemp, open, readdir, rm, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LedgerImportValidationError, checksumFile, importLedgerFile, loadLedgerEnvironment, type LedgerImportResult } from "../imports/import-ledger.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, "../../../../");
const execFileAsync = promisify(execFile);

export type InboxFileResult = {
  fileName: string;
  status: "IMPORTED" | "SKIPPED_DUPLICATE" | "SKIPPED_COPYING" | "REJECTED" | "FAILED";
  checksum?: string;
  batchId?: string;
  existingBatchId?: string;
  unmappedAccountCount?: number;
  unmappedAccounts?: string[];
  reason?: string;
  alertDelivered?: boolean;
};

type StatLike = { size: number; mtimeMs: number };
type StableFileOptions = {
  minAgeMs: number;
  stabilityWaitMs: number;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
  getStat?: (filePath: string) => Promise<StatLike>;
  openForRead?: (filePath: string) => Promise<void>;
};

const pause = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function openForRead(filePath: string) {
  const handle = await open(filePath, "r");
  await handle.close();
}

export async function isStableInboxFile(filePath: string, options: StableFileOptions) {
  const now = options.now ?? Date.now;
  const wait = options.wait ?? pause;
  const getStat = options.getStat ?? (async (target) => stat(target));
  const checkOpen = options.openForRead ?? openForRead;
  let first: StatLike;
  try { first = await getStat(filePath); }
  catch { return false; }
  if (now() - first.mtimeMs < options.minAgeMs) return false;
  await wait(options.stabilityWaitMs);
  let second: StatLike;
  try { second = await getStat(filePath); }
  catch { return false; }
  if (second.size !== first.size || second.mtimeMs !== first.mtimeMs) return false;
  try { await checkOpen(filePath); }
  catch { return false; }
  return true;
}

async function isWindowsHidden(filePath: string) {
  if (process.platform !== "win32") return false;
  try {
    const { stdout } = await execFileAsync("attrib", [filePath], { windowsHide: true });
    return stdout.slice(0, 8).includes("H");
  } catch { return false; }
}

function ignoredFileName(name: string) {
  return name.startsWith(".") || name.startsWith("~$") || /\.(?:tmp|part)$/i.test(name) || !name.toLowerCase().endsWith(".xlsx");
}

function sameSnapshot(left: StatLike | undefined, right: StatLike | undefined) {
  return Boolean(left && right && left.size === right.size && left.mtimeMs === right.mtimeMs);
}

function isRetryableFileError(error: unknown) {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "EBUSY" || code === "EPERM" || code === "EACCES" || code === "ETXTBSY" || code === "ENOENT";
}

async function moveWithoutOverwrite(source: string, target: string) {
  await mkdir(path.dirname(target), { recursive: true });
  try {
    await link(source, target);
    await rm(source);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw error;
    if ((error as NodeJS.ErrnoException).code !== "EXDEV" && (error as NodeJS.ErrnoException).code !== "EPERM" && (error as NodeJS.ErrnoException).code !== "EACCES") throw error;
    await copyFile(source, target, fsConstants.COPYFILE_EXCL);
    await rm(source);
  }
}

async function archivedPath(directory: string, date: string, checksum: string, originalName: string) {
  const parsed = path.parse(originalName);
  const stem = `${date} - ${checksum.slice(0, 8)} - ${parsed.name}`;
  for (let suffix = 0; ; suffix += 1) {
    const name = `${stem}${suffix ? ` (${suffix + 1})` : ""}${parsed.ext}`;
    const candidate = path.join(directory, name);
    try { await stat(candidate); }
    catch { return candidate; }
  }
}

async function sendRejectionAlert(fileName: string, reason: string, webhook = process.env.TEAMS_WEBHOOK_URL) {
  if (!webhook) return false;
  const response = await fetch(webhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: `Controle Orçamentário: o arquivo do Livro Razão ${fileName} foi rejeitado. Motivo: ${reason}` }),
  });
  if (!response.ok) throw new Error(`Falha ao enviar alerta para Teams (${response.status}).`);
  return true;
}

export type RunInboxOptions = {
  inboxDirectory: string;
  minAgeMs?: number;
  stabilityWaitMs?: number;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
  getStat?: (filePath: string) => Promise<StatLike>;
  openForRead?: (filePath: string) => Promise<void>;
  checksum?: (filePath: string) => Promise<string>;
  importFile?: (filePath: string, source: "AUTOMATICO", checksum: string, originalFilename: string) => Promise<LedgerImportResult>;
  alert?: (fileName: string, reason: string) => Promise<boolean>;
};

export async function runLedgerInbox(options: RunInboxOptions): Promise<InboxFileResult[]> {
  const inboxDirectory = path.resolve(options.inboxDirectory);
  const minAgeMs = options.minAgeMs ?? 15_000;
  const stabilityWaitMs = options.stabilityWaitMs ?? 2_000;
  const getChecksum = options.checksum ?? checksumFile;
  const importFile = options.importFile ?? importLedgerFile;
  const alert = options.alert ?? sendRejectionAlert;
  await mkdir(inboxDirectory, { recursive: true });
  const names = (await readdir(inboxDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && !ignoredFileName(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
  const results: InboxFileResult[] = [];

  for (const fileName of names) {
    const sourcePath = path.join(inboxDirectory, fileName);
    if (await isWindowsHidden(sourcePath)) continue;
    const stable = await isStableInboxFile(sourcePath, {
      minAgeMs, stabilityWaitMs, now: options.now, wait: options.wait, getStat: options.getStat, openForRead: options.openForRead,
    });
    if (!stable) {
      results.push({ fileName, status: "SKIPPED_COPYING" });
      continue;
    }

    let checksum: string | undefined, stagingDirectory: string | undefined, sourceSnapshot: StatLike | undefined;
    try {
      const sourceBeforeCopy = await stat(sourcePath);
      stagingDirectory = await mkdtemp(path.join(tmpdir(), "ledger-inbox-"));
      const stagedPath = path.join(stagingDirectory, fileName);
      await copyFile(sourcePath, stagedPath);
      const [sourceAfterCopy, stagedStat] = await Promise.all([stat(sourcePath), stat(stagedPath)]);
      if (sourceAfterCopy.size !== sourceBeforeCopy.size || sourceAfterCopy.mtimeMs !== sourceBeforeCopy.mtimeMs || stagedStat.size !== sourceAfterCopy.size) {
        results.push({ fileName, status: "SKIPPED_COPYING" });
        await rm(stagingDirectory, { recursive: true, force: true });
        continue;
      }
      sourceSnapshot = sourceAfterCopy;
      checksum = await getChecksum(stagedPath);
      const imported = await importFile(stagedPath, "AUTOMATICO", checksum, fileName);
      const sourceAfterImport = await stat(sourcePath);
      if (!sameSnapshot(sourceSnapshot, sourceAfterImport)) {
        results.push({ fileName, status: "SKIPPED_COPYING", checksum });
        continue;
      }
      const date = new Date((options.now ?? Date.now)()).toISOString().slice(0, 10);
      const destinationDir = path.join(inboxDirectory, "processados");
      const destination = await archivedPath(destinationDir, date, checksum, fileName);
      await moveWithoutOverwrite(sourcePath, destination);
      results.push(imported.skippedDuplicate
        ? { fileName, status: "SKIPPED_DUPLICATE", checksum, existingBatchId: imported.existingBatchId }
        : { fileName, status: "IMPORTED", checksum, batchId: imported.batchId, unmappedAccountCount: imported.unmappedAccountCount, unmappedAccounts: imported.unmappedAccounts });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Falha desconhecida ao processar o arquivo.";
      if (error instanceof LedgerImportValidationError && checksum) {
        const currentSnapshot = await stat(sourcePath).catch(() => undefined);
        if (!sameSnapshot(sourceSnapshot, currentSnapshot)) {
          results.push({ fileName, status: "SKIPPED_COPYING", checksum });
          continue;
        }
        const date = new Date((options.now ?? Date.now)()).toISOString().slice(0, 10);
        const destinationDir = path.join(inboxDirectory, "rejeitados");
        const destination = await archivedPath(destinationDir, date, checksum, fileName);
        await moveWithoutOverwrite(sourcePath, destination);
        await writeFile(`${destination}.erro.txt`, `${reason}\n`, { flag: "wx" });
        let alertDelivered = false;
        try { alertDelivered = await alert(fileName, reason); }
        catch (alertError) { console.error("Falha ao alertar sobre Livro Razão rejeitado:", alertError); }
        results.push({ fileName, status: "REJECTED", checksum, reason, alertDelivered });
      } else {
        results.push({ fileName, status: isRetryableFileError(error) ? "SKIPPED_COPYING" : "FAILED", checksum, reason });
      }
    } finally {
      if (stagingDirectory) await rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  }
  return results;
}

async function run() {
  loadLedgerEnvironment();
  const configuredDirectory = process.env.LEDGER_INBOX_DIR?.trim() || "./data/inbox/livro-razao";
  const inboxDirectory = path.isAbsolute(configuredDirectory) ? configuredDirectory : path.resolve(projectRoot, configuredDirectory);
  const minAgeMs = Number(process.env.LEDGER_INBOX_MIN_AGE_MS?.trim() || "15000");
  const stabilityWaitMs = Number(process.env.LEDGER_INBOX_STABILITY_WAIT_MS?.trim() || "2000");
  if (!Number.isFinite(minAgeMs) || minAgeMs < 0 || !Number.isFinite(stabilityWaitMs) || stabilityWaitMs < 0) throw new Error("LEDGER_INBOX_MIN_AGE_MS e LEDGER_INBOX_STABILITY_WAIT_MS devem ser números não negativos.");
  const results = await runLedgerInbox({ inboxDirectory, minAgeMs, stabilityWaitMs });
  console.log(JSON.stringify({ inboxDirectory, processedAt: new Date().toISOString(), results }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch((error) => { console.error(error); process.exitCode = 1; });
}
