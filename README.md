# osu!mania 4K 树星数 v1（浏览器版）

上传 `.osu` 或 `.osz`，在**浏览器本地**算出 osu!mania 4K 谱面的“树星数 v1”。纯静态网页，可以直接放在 GitHub Pages 上；
使用者不需要安装 Python / PyTorch / CUDA，文件不会上传到任何服务器。

试用网页：https://sky2002.github.io/osu-star-web/ 。反馈：https://github.com/sky2002/osu-star-web/issues/new 。

- 版本：树星数 v1（研究项目里的模型名 P1h，冻结日期 2026-10-14）。
- 含义：平均要多强的玩家，才能在这张谱上打到 96% 准确率（stable ScoreV1 口径，用谱面文件里的 OD）。
- 刻度：星数 = 5.2338 + 1.6089 × 读数。它和以前本机网页上的“公共星数”（4.6146 + 1.3714·θ\*）不是同一把尺子，难谱上大约高 1 星以上，不要混着比较。
- 不是 osu! 官方星数；只出 1.0 倍速。

> **公开性**：GitHub Pages 站点对任何拿到网址的人公开，模型文件（`docs/model/`）也可以被任何人下载。
> 项目维护者已接受“知道网址就能用、群友外传也可以”。

## 页面功能

- 拖入或选择多个 `.osu` / `.osz`；`.osz` 在浏览器里解压（fflate），列出全部难度，只计算 mania 4K 的难度。
- 每个难度显示树星数 v1（两位小数）、物件数、分段曲线（每 10 秒一段，旧公共星数刻度，只看起伏）和最难的一段。
- 拒绝并说明：不是 mania、不是 4K、物件少于 20 个。
- 标“不可靠”（仍给读数）：
  - 有变速：超过 10% 的物件处滚动速度偏离主速度 10% 以上（研究库 `frac_scroll_dev10 > 0.10`，训练时排除的同一规则）；
  - 带 storyboard：`.osz` 内有 `.osb`，或 `.osu` 的 `[Events]` 里有 Sprite / Animation 对象（研究库 `sb_lines ≥ 1`）；
  - 超出排名谱训练范围：星数 > 8.94（可用排名谱 1.0 倍最高读数），或参照水平读数 θ\* 超出排名谱的范围 [−3.14, 1.98]（含被截断到路径两端），
    或 22 项谱面特征中任一项超出可用排名谱的最小–最大范围（范围见 `docs/model/support.json`，20,834 张可用排名谱）。
- jack 提示：同列 180 ms 内连打的比例 ≥ 0.42（排名谱第 90 百分位）且长条比例 < 30% 时提示“按 acc 定义，读数通常比段位手感低约 1 段”
  （这条经验来自米谱 / REFORM 段位，长条为主的谱不提示）。
- 每个结果旁有“复制读数信息”（谱名、难度名、beatmap id、md5、星数、版本号、不可靠标记），页面顶部和底部有“反馈”链接（指向仓库 Issues）。
  页面本身不收集、不上传任何数据。

## 技术路线（为什么这样做）

读数 = HistGBDT（22 个手工谱面特征 + r2-final-s29 的 θ\*）。θ\* 需要跑一个小 Transformer 编码器（2 层 × 128 宽，前瞻 2 秒掩码），
再经过“参照水平路径”37 个点上的第二层，把每个动作的打击误差分布换算成期望准确率，最后在 96% 处插值。

| 部分 | 浏览器里的实现 | 说明 |
|---|---|---|
| 编码器 | ONNX（1.15 MB）+ onnxruntime-web 1.30.0（WASM SIMD，单线程） | 两个前瞻掩码由 JS 按窗口内时间算好后作为输入传入 |
| 分词（17 维动作 token、和弦对称排序、镜像） | JS（`docs/js/tokens.js`） | 逐行对照研究代码移植 |
| 第二层（37 个参照水平 × 每个动作的 ScoreV1 期望分）、θ\* 插值 | JS（`docs/js/reader.js`、`tdist.js`） | 按 PyTorch 的 float32 步骤用 `Math.fround` 复现；Student-t 表在浏览器里现算（与 Python 表逐位相同） |
| 22 个特征、树 | JS（`features.js`、`tree.js`，树导出为 `tree.json`） | 分位数按 NumPy 的 linear 方法逐位复现 |
| 长谱加速 | 页面另开 2–8 个辅助 worker 并行算第二层（按参照水平分段） | 结果与单线程路径逐位相同；不需要跨源隔离头 |

没有选 Pyodide：要带上 NumPy/SciPy/sklearn 和 PyTorch 等价物，首次下载几十 MB 且仍跑不了 PyTorch。ONNX 路线首次下载约 15 MB（其中 14.2 MB 是
onnxruntime 的 WASM，GitHub Pages 会 gzip 压缩），模型本身约 1.8 MB。

### 实测耗时（本机浏览器面板，Chromium，2026-10-14）

| 谱面 | 动作数 | 耗时 |
|---|---:|---:|
| 普通排名谱（473874，约 1,500 动作） | 1,516 | 约 0.3 秒 |
| REFORM Eta Stamina（米） | 3,864 | 约 0.5 秒 |
| LN 段位 15th Dan 马拉松（12,852 物件 / 10,829 长条） | 23,681 | 约 3.2 秒（6 个辅助 worker）；单线程约 11–12 秒 |
| 模型加载（本地） | — | 约 0.2–0.3 秒（不含下载） |

瓶颈是长条的 ScoreV1 合成分（每个长条 37 个水平 × 96 个积分点）。辅助 worker 数 = min(8, CPU 逻辑核数 − 2)，少于 2 时不开，退回单线程。

## 目录

```
docs/                 ← GitHub Pages 站点根（Settings → Pages 选 /docs）
  index.html  css/  js/
    app.js ui-lib.js md5.js       页面（主线程）
    worker.js engine.js           计算 worker 与整体流程
    osu.js tokens.js reader.js tdist.js features.js tree.js pyutil.js   数值部分
    pool.js sl-worker.js          长谱辅助 worker
    mock-worker.js                界面自测用假 worker（?mock=1）
  model/
    encoder.onnx  reader.json  tree.json  support.json
  vendor/ort/  vendor/fflate/     第三方库（原样复制，MIT）
tests/
  compare.mjs                     与 Python 参考实现逐值比对（Node）
  fixtures/reference.json         Python 参考读数（374 张：test_beatmap 全部 + 随机 200 张排名谱）
  tdist_check.mjs onnx_smoke.mjs profile.mjs npy.mjs
tools/serve.mjs                   本地静态服务器（只用于自测）
```

## 导出物清单（隐私检查）

- `encoder.onnx`：编码器权重（projection 17→128、2 个 Transformer 块、最终 LayerNorm、local 头 128→2）和 RoPE 的 cos/sin 表。
  已去掉导出器写入的元数据（堆栈里带本机路径），并检查不含本机路径字符串。**不含**任何玩家参数（公开权重本来就不含玩家 / 日 / 时间参数）。
- `reader.json`：token 标准化常数（17 维）、FiLM 组尺度（2 个数）、参照水平路径 37 个点的第二层系数（ls0、ls1、mu0、mu1、lg0、lg1、ν，各 37×2）、
  Student-t 自由度与对数常数、θ 网格、前瞻规则、θ 标记范围（2 个数：训练组水平的最小/最大）、旧公共星数刻度（只用于分段曲线）。
  参照路径是 62 组玩家参数对水平的回归**斜率**，不含任何一组的参数、代号或 replay 数据。
- `tree.json`：树模型的切分特征序号、阈值、叶值。
- `support.json`：可用排名谱上 22 个特征、θ\*、星数的范围（统计量）。
- 测试夹具 `tests/fixtures/reference.json`：谱面文件的相对路径（test_beatmap 文件名、排名谱 beatmap id）、Python 参考读数与中间量；不在站点目录里，但会随仓库公开。

## 本地预览

```
node tools/serve.mjs 8790        # 打开 http://127.0.0.1:8790/ ，用完 Ctrl+C 关掉
```

`?mock=1` 用假 worker 只看界面。必须通过 http 打开（直接双击 index.html 不能加载 worker 和模型）。

## 一致性测试

需要研究仓库（谱面文件只从那里读，只读）：

```
npm install                                   # onnxruntime-web 1.30.0、fflate 0.8.3（只用于 Node 测试）
OSU_DIFF_ROOT=<研究仓库根目录> node tests/compare.mjs [--limit N] [--tol 0.01]
```

结果写到 `tests/out/`（不入库）。比对对象：研究仓库 `analysis/tree-topend-r3/score_osu.py` 的 `Scorer('P1h')`（CPU）；
夹具由研究仓库 `analysis/web-export-r1/reference.py` 生成，模型文件由 `analysis/web-export-r1/export.py` 生成。
Node 测试走单线程路径（辅助 worker 路径用同一函数，浏览器里核对过同一结果）。

最近一次结果（2026-10-14）：374 张（test_beatmap 174 个难度 + 随机 200 张排名谱）中 368 张出读数、6 张被双方以“物件少于 20”拒绝；
368 张的星数与 Python 参考**逐位相同**（最大差 0），θ\* 最大差 2.5e-7，22 个特征最大差 1.8e-15。
另有 `tests/tdist_check.mjs`（Student-t 表与 Python 表 60.6 万项逐位相同）、`tests/flags_check.mjs`
（变速 / storyboard 判定与研究库谱表在 3,100 张排名谱上判定全部一致）。

发布前复核（2026-10-14）仅重新抽样 24 个输入案例（23 个不同难度，含同谱 `.osu`/`.osz` 双路径）：16 个定向 `test_beatmap` 样本覆盖米谱、长条、长马拉松、Eta、高难谱和 3 个少于 20 物件的拒绝案例；
另从既有随机 200 张排名谱中按星数四分位分层，每层用固定种子 20261014 再抽 2 张。24 个结果均通过：21 张出读数、3 张双方拒绝；
21 张星数均与 Python 参考逐位相同，θ* 最大差 1.44e-7，22 项特征最大差 8.89e-16。另复核非 mania、非 4K、压缩包难度筛选、storyboard 提示和分段曲线。
本次复用了上述 374 张历史全量结果，没有重新执行全量回读；有限抽样不能证明所有谱面都正确。

## 部署到 GitHub Pages（由项目维护者决定后再做）

1. 仓库地址：`https://github.com/sky2002/osu-star-web`。把本目录推上去（`node_modules/`、`tests/out/`、`.pydeps/` 已在 `.gitignore`）。
2. 反馈地址已经设置为 `https://github.com/sky2002/osu-star-web/issues/new`；
   仓库 Settings → General → Features 勾选 Issues。
3. Settings → Pages → Build and deployment → Source 选 “Deploy from a branch”，Branch 选 `master`，文件夹选 `/docs`，保存。`docs/.nojekyll` 使站点按纯静态文件服务。
4. 站点地址是 `https://sky2002.github.io/osu-star-web/`。部署完成后打开并拖一张谱试算，确认状态栏显示“模型已就绪”。
5. 注意：站点和模型文件对任何拿到网址的人公开；仓库公开时源代码、测试夹具（谱面文件名与读数）也公开。

更新模型时：在研究仓库重跑 `export.py` 与 `reference.py`，跑 `tests/compare.mjs`，确认后改 `docs/js/engine.js` 里的 `VERSION` / `FROZEN` 再推送。

## 已知限制

- 读数来自 P1h：Zeta→Eta 一跳约 1.1 星，Eta 类谱读到 9.5–9.8 星，高于所有排名谱的最高读数（8.94），这一段没有独立答案可查（会标“不可靠：超出范围”）。
- 段位谱里 LN 段位（按 97% ScoreV2 定义）与 jack 包存在已知倒挂；jack/chordjack 多的谱按 acc 定义通常比段位手感低约 1 段。
- 有变速、带 storyboard 的谱训练时被排除，读数未经检验。
- 只出 1.0 倍；不处理 DT/HT 等 mod。
- 非常老的浏览器（不支持模块 worker / WebAssembly SIMD）无法使用。
