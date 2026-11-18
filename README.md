# TaBello 本地识别与制谱

本项目提供一个独立的 Node.js 扒谱命令。核心音频识别和制谱代码取自 TaBello 提交 `73358c05de2b1bf4a5b47c610fe29cd18fefb94e`，保留原目录结构。新增入口位于 `src/analyze.ts` 和 `src/cli.ts`。每个命令处理一个本地 MP3，使用原有 Basic Pitch CPU WASM 模型，输出一条吉他轨的 AlphaTex。

## 在 Windows PowerShell 中运行

需要 Node.js 24.22.1 或更新版本（也支持 22.23.4 及同主版本的更新补丁），以及可从终端调用的 FFmpeg。在本目录运行：

```powershell
npm ci
ffmpeg -version
npm test
npm run --silent analyze -- "C:\Music\guitar.mp3"
```

如果 FFmpeg 没有加入 PATH，可以用 `$env:FFMPEG_BIN = "C:\ffmpeg\bin\ffmpeg.exe"` 指定。安装 npm 依赖时需要下载包，Basic Pitch 权重和 WASM 已包含其中。安装完成后可以离线识别。单文件上限为上游常规路径的 15 分钟。

## 从后端调用

每项任务启动一个命令进程。标准输出是一行 JSON，字段包括：

- `notes` 包含识别出的音符，起点和时长以秒为单位。
- `durationSeconds` 是解码音频的长度。
- `alphaTex` 可直接交给 alphaTab。
- `startTime` 和 `barTimes` 是在原录音时间轴上的谱面起点和小节边界。
- `droppedNotes` 是编排阶段无法布置到指板上的音符数。
- `metronome` 只有检测到节拍器时才返回。

标准错误输出 JSON Lines 格式的 `progress` 或 `error` 事件。进度按 `extracting`、`transcribing`、`arranging` 各阶段独立计量。进程以 0 表示成功，以 1 表示分析失败。本阶段适用于以独奏吉他为主的音频。相关许可证和上游第三方说明见 `LICENSE` 和 `THIRD_PARTY_NOTICES.md`。

## 启动本地 HTTP API

在本目录运行 `npm start`，默认监听 `http://127.0.0.1:3000`。可通过环境变量 `PORT` 指定端口。Vite 前端可将同源的 `/api` 请求代理到这个地址。

| 请求 | 输入 | 成功响应 |
|---|---|---|
| `POST /api/audio/upload` | multipart 表单中的 `audio` 字段，单个 MP3，最多 25 MiB | HTTP 201，`{ "uploadId": "…" }` |
| `POST /api/audio/analyze` | JSON `{ "uploadId": "…", "mode": "accompaniment" }`（mode 可选，API 默认 transcription） | HTTP 202，`{ "taskId": "…", "status": "queued" }` |
| `GET /api/tasks/:id` | 上一步的任务 ID | HTTP 200，`id`、`status`，以及按状态提供的 `progress`、`result` 或 `error` |

上传 ID 可提交一次。任务依次运行，状态为 `queued`、`running`、`completed` 或 `failed`。进度格式为 `{ "stage": "transcribing", "fraction": 0.5 }`，比例以当前阶段为准。成功的 `result` 与命令行 JSON 一致。失败任务和 HTTP 错误均使用 `error.code` 和 `error.message`。

待提交文件和已结束任务保留 30 分钟。分析结束后清理临时音频，单个任务超时为 5 分钟。任务记录保存在内存，服务重启后需要重新上传。前端可用用户已选择的本地 File 播放原音。

## 在浏览器里验收

从本目录构建网页后启动服务：

```powershell
npm ci
npm run build:web
npm start
```

打开 `http://127.0.0.1:3000/`。可以点击「查看示例谱」并切换两条吉他轨，也可以选择或拖入本地 MP3，点击「生成吉他谱」，再查看六线谱和试听原始录音。分析结果目前只生成一条吉他轨。播放原始录音时，六线谱光标会跟随播放并高亮当前音符。可选择 0.5× 至 1.5× 的播放速度，或选择起始与结束小节后点击「循环练习」。

开发时可以在保持后端运行的同时，另开终端运行 `npm run dev:web` 并访问 Vite 显示的地址。项目使用当前工作区的独立 Vite 页面，待取得 Windows 本地 `alphatab-demo` 源码后可迁移到其现有入口。

谱面按小节显示和弦指法，六线谱保留节奏符干和连梁，下方用数字简谱显示吉他上声部的最高音。简谱是练习参考，来自识别后的吉他声部。上传流程只接收 MP3，因此不会自动添加歌词或歌手、词曲作者信息。

## 编辑和保存曲谱

生成曲谱后，点谱面上方的「编辑曲谱」。可以直接点击六线谱上的品位，也可以选择小节、声部和拍位。选中已有音符后修改目标弦或品位，点击「应用修改」。要补音，选择「添加新音符」再指定弦和品位。支持删除、撤销和重做。对延音链的修改或删除会作用于整条延音链。

编辑保留原有节奏网格，方便继续跟随原录音。数字简谱会随音符更新，和弦标记来自原始识别结果。编辑历史保留到切换曲谱或刷新前。点击「导出 Guitar Pro」将修改后的谱保存为 `.gp` 文件。

网页编辑使用 [alphaTab](https://github.com/CoderLine/alphaTab) 的谱面模型与 Guitar Pro 7 导出器。编辑流程参考了 [TaBello 的源码](https://github.com/JackF007/taBello/blob/73358c05de2b1bf4a5b47c610fe29cd18fefb94e/src/renderer/src/lib/music/edit.ts)。[TuxGuitar](https://github.com/helge17/tuxguitar) 可作为独立的桌面制谱工具。

「保存项目」下载 `.geota` 文件，包含修改后的谱面、原录音与小节同步信息。刷新或重启后点击「打开项目」即可继续编辑和练习，原录音随项目恢复。项目文件可以包含完整的原始 MP3。撤销历史仅保存在当前页面，重开项目从已保存的版本开始。


## 生成简化伴奏谱

网页默认生成「简化伴奏谱」。它使用检测到的和弦在较低把位编排分解和弦或扫弦，和弦图放在相应拍位上方，并保留原有小节时间用于原音同步。缺少可用和弦指法的片段会保留原谱的吉他上声部。也可切换到「原音扒谱」查看识别出的指法；通过谱面上方的复选框可以显示数字简谱。该模式针对练习重新编配，和弦和节奏仍可与参考谱有差异。
