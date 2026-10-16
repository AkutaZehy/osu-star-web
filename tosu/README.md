# osu!mania 4K 星数 · tosu 插件（试用）

把网页版星数工具（树星数 v1 / P1h）做成 [tosu](https://github.com/tosuapp/tosu) 计数器。
选歌时自动读出当前谱面的星数，同时考虑当前 Mod。读数和网页版是同一套计算，全部在本机进行，不上传谱面。

> **请在选歌界面打开本插件，不要在打歌途中启用。**
> 首次加载模型（约 16 MB）和计算会占用 CPU，可能造成卡顿。
> 插件检测到正在打歌时会自动暂停：不加载模型；正在进行的计算会被中止，回到选歌界面后再重新计算。

## 安装

1. 安装并运行 tosu。
2. 把 `osu-star-tosu` 整个文件夹放进 tosu 的 `static` 文件夹（tosu 设置里叫 counters / static 文件夹）。
3. 打开 `http://127.0.0.1:24050/`，在本地计数器列表里找到“osu!mania 4K 星数（P1h）”。
   可以添加为 OBS 浏览器源，也可以加入 tosu 的游戏内叠加层。建议大小 380 × 220。

可选网址参数：

- `?helpers=2`：额外开 2 个辅助线程，加快长谱计算，但会占用更多 CPU。默认 0。
- `?hint=0`：隐藏底部的使用提示。

## 读数说明

- 只支持 osu!mania 4K（不支持转谱）。物件少于 20 个时不计算。
- 同一张谱、同一组 Mod 只算一次，结果会缓存在浏览器里，重开 tosu 后仍然有效。
- 星数是社区试用读数，不是 osu! 官方星数；口径与已知限制见[网页版说明](https://github.com/sky2002/osu-star-web#readme)。

### Mod

| Mod | 处理方式 | 检验情况 |
|---|---|---|
| NoMod | 按谱面原样计算 | 已检验 |
| DT / NC（1.5 倍） | 与网页版 DT 相同 | 已检验（顶端主要是外推） |
| HT / DC（0.75 倍） | 与网页版 HT 相同 | 未经检验 |
| lazer 自定义倍速（0.5–2 倍） | 时间除以倍速，判定区间按 stable DT/HT 的规则随倍速缩放 | 未经检验 |
| HR / EZ | 按 stable 规则，判定区间 ÷1.4 / ×1.4 | 未经检验 |
| Difficulty Adjust 改 OD（lazer） | 用改后的 OD 判定，OD 特征也换成改后的值 | 未经检验 |
| HD、FI、FL、NF、SD、PF、MR 等 | 不影响读数，忽略并列出 | — |
| RD、IN、HO、NR、DS、改键数、WU/WD/AS | 会改谱面或倍速随时间变化，不计算 | — |

树模型只在 NoMod 和 1.5 倍的人群成绩上训练、检验过，其他组合都是同一套规则推出来的，会在卡片上标注“未经检验”。
所有倍速、HR/EZ 和改 OD 的 JS 读数都已与 Python 参照实现逐位核对（`tests/compare_mods.mjs`）。

## 开发

```
node tools/build-tosu.mjs     # 生成 dist/osu-star-tosu/ 和 dist/osu-star-tosu.zip
node tools/mock-tosu.mjs      # 模拟 tosu：http://127.0.0.1:24050/osu-star-tosu/
```

用 `GET /mock?file=<.osu 路径>&state=<5 选歌 / 2 打歌>&mods=<JSON>` 切换模拟状态。
插件代码在 `tosu/`，计算部分直接复制 `docs/js`、`docs/model` 和 `docs/vendor/ort`，不另做修改。
