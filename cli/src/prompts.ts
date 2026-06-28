import { createInterface, type Interface } from "node:readline";
import { Writable } from "node:stream";
import { stdin, stdout } from "node:process";

// One shared readline interface for an interactive flow. We consume its `line`
// events through a queue so that lines which arrive before we ask for them (e.g.
// piped stdin delivering every line at once) are not dropped — a plain
// sequence of rl.question() calls loses them. Password echo is hidden by routing
// readline's output through a stream we silence on demand.
let rl: Interface | null = null;
let muted = false;
const lineQueue: string[] = [];
const waiters: Array<(line: string) => void> = [];

const mutableOut = new Writable({
  write(chunk, _enc, cb) {
    if (!muted) stdout.write(chunk);
    cb();
  },
});

function ensureRl(): void {
  if (rl) return;
  rl = createInterface({ input: stdin, output: mutableOut, terminal: Boolean(stdin.isTTY) });
  rl.on("line", (line) => {
    const waiter = waiters.shift();
    if (waiter) waiter(line);
    else lineQueue.push(line);
  });
}

function nextLine(): Promise<string> {
  ensureRl();
  const queued = lineQueue.shift();
  if (queued !== undefined) return Promise.resolve(queued);
  return new Promise((resolve) => waiters.push(resolve));
}

export function closePrompts(): void {
  if (rl) {
    rl.close();
    rl = null;
  }
}

export async function promptLine(question: string): Promise<string> {
  stdout.write(question);
  return (await nextLine()).trim();
}

export async function promptPassword(question: string): Promise<string> {
  stdout.write(question);
  muted = true;
  const line = await nextLine();
  muted = false;
  stdout.write("\n");
  return line.trim();
}
