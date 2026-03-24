import { spawn } from 'child_process';

spawn('powershell', ['-File', 'C:/Users/alexi/.claude/hooks/play-complete.ps1'], {
  detached: true,
  stdio: 'ignore',
}).unref();
