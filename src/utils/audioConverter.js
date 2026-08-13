/**
 * audioConverter.js
 * Converte áudio WebM (gravado pelo Chrome) → OGG Opus (formato nativo WhatsApp).
 *
 * WhatsApp aceita áudio SOMENTE em OGG/Opus (ou MP3/MP4 como arquivo).
 * Chrome grava em WebM/Opus — mesmo codec, container diferente.
 *
 * Usa ffmpeg-static: binário ffmpeg pré-compilado incluído como pacote npm.
 * Não requer instalação de sistema — funciona no Railway sem configuração extra.
 */

'use strict';

const { spawn }    = require('child_process');
const ffmpegPath   = require('ffmpeg-static'); // binário embutido no npm package

/**
 * Converte buffer WebM/Opus → buffer OGG/Opus via ffmpeg.
 * @param {Buffer} webmBuffer  — buffer do arquivo WebM gravado pelo browser
 * @returns {Promise<Buffer>}  — buffer OGG pronto para envio ao WhatsApp
 */
async function converterWebmParaOgg(webmBuffer) {
  return new Promise((resolve, reject) => {
    // ffmpeg lê de stdin (-i pipe:0) e escreve em stdout (pipe:1)
    const proc = spawn(ffmpegPath, [
      '-loglevel', 'error',        // silencia logs informativos
      '-i', 'pipe:0',              // input: stdin
      '-vn',                       // ignora stream de vídeo (WebM pode ter)
      '-acodec', 'libopus',        // codec Opus (mesmo do WebM — re-encode rápido)
      '-ar', '16000',              // 16kHz — padrão WhatsApp PTT
      '-ac', '1',                  // mono
      '-b:a', '32k',               // bitrate 32kbps (suficiente para voz)
      '-f', 'ogg',                 // container: OGG
      'pipe:1',                    // output: stdout
    ]);

    const chunks = [];
    let stderrOut = '';

    proc.stdout.on('data', (chunk) => chunks.push(chunk));
    proc.stderr.on('data', (d) => { stderrOut += d.toString(); });

    proc.on('close', (code) => {
      if (code === 0 && chunks.length > 0) {
        const oggBuffer = Buffer.concat(chunks);
        console.log('AUDIO_CONVERTER_OK', { inBytes: webmBuffer.length, outBytes: oggBuffer.length });
        resolve(oggBuffer);
      } else {
        console.warn('AUDIO_CONVERTER_FAIL', { code, stderr: stderrOut.slice(0, 200) });
        reject(new Error(`ffmpeg saiu com código ${code}: ${stderrOut.slice(0, 100)}`));
      }
    });

    proc.on('error', (err) => {
      console.warn('AUDIO_CONVERTER_SPAWN_FAIL', { erro: err.message });
      reject(err);
    });

    // Escreve o WebM no stdin do ffmpeg
    proc.stdin.write(webmBuffer);
    proc.stdin.end();
  });
}

/**
 * Tenta converter WebM → OGG. Se ffmpeg não estiver disponível,
 * retorna null (controller usa fallback com WebM).
 */
async function tentarConverter(webmBuffer) {
  try {
    return await converterWebmParaOgg(webmBuffer);
  } catch (e) {
    console.warn('AUDIO_CONVERTER_SKIP', { motivo: e.message });
    return null;
  }
}

module.exports = { converterWebmParaOgg, tentarConverter };
