import { PipelineError } from './main/transcription/pipeline';
import { analyzeMp3 } from './analyze';

try {
  const [inputPath, ...extra] = process.argv.slice(2);
  if (!inputPath || extra.length) {
    throw new PipelineError('invalid', 'Usage: npm run --silent analyze -- "path/to/recording.mp3"');
  }

  const result = await analyzeMp3(inputPath, {
    ffmpegPath: process.env.FFMPEG_BIN,
    title: process.env.TABELLO_AUDIO_TITLE,
    onProgress: (stage, fraction) => {
      process.stderr.write(JSON.stringify({ type: 'progress', stage, fraction }) + '\n');
    },
  });
  process.stdout.write(JSON.stringify(result) + '\n');
} catch (error) {
  process.stderr.write(JSON.stringify({
    type: 'error',
    code: error instanceof PipelineError ? error.code : 'failed',
    message: error instanceof Error ? error.message : String(error),
  }) + '\n');
  process.exitCode = 1;
}
