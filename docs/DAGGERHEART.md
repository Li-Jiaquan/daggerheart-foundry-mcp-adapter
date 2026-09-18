# Daggerheart 基础适配器

本地开发版，基于 Ninjo's Foundry MCP `v14.2609.4`，按 Foundryborne 官方 Daggerheart `2.9.4` 的实际安装代码核对字段。只匹配系统 ID `daggerheart`。尚未在连接中的真实世界完成联调；自动化验证使用合成数据和项目提供的 Foundry 模拟环境。

## 已实现

| 工具                                        | Daggerheart 支持                                                                                                                                 |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `get-character`                             | PC 的等级、六特质、经历、生命、压力、希望、闪避、护甲、伤害阈值、熟练值和起源物品；敌人的阶级、类型、难度和资源；NPC、环境、伙伴与队伍的适用字段 |
| `get-character-entity`                      | 沿用原有物品详情接口，并增加领域卡、装备的紧凑元数据                                                                                             |
| `search-character-items`                    | 装备、特性、领域卡、法术／法典、携带区、保管库等分类                                                                                             |
| `list-creatures-by-criteria`                | 只索引 `adversary`，支持 `tier`、`adversaryType`、`difficulty`、`hitPoints`、`stress`；保留原有名称、类型和包筛选                                |
| `search-compendium` / `get-compendium-item` | 敌人和环境的紧凑数值摘要，兼容嵌套与点号形式的索引字段                                                                                           |
| `manage-actors` 的 `describe`               | 返回真实字段路径、资源方向和派生值注意事项                                                                                                       |
| `roll-actor-check`                          | `trait`、`spellcast`、`attack` 调用系统原生双元骰；返回 Hope/Fear 与 Hope/Fear/Stress 自动资源更新结果；`custom` 保留通用公式                    |

模块端和服务端注册同一个纯数据适配器，既有 MCP 工具名称不变。现有写入接口继续使用原权限检查；本适配器不转换写入数据，不新增写入工具。

## 数值含义

- 生命、压力、护甲的 `value` 是**已标记格数**，0 表示尚未标记。摘要同时返回 `marked`、`remaining` 和 `meaning: "marked"`。
- 希望的 `value` 是可用数量，返回 `meaning: "available"`。恐惧不是角色资源，本适配器不虚构恐惧值。
- `valuesSource: "prepared"` 表示桥接读取了 Foundry 已计算的数值，包含职业、升级与效果修正。避免再次叠加这些修正。
- 只有存储数据时，PC／伙伴的派生防御、熟练值与资源上限返回 `null`，并说明原因。特质与经历可能只是基础值。角色 `resources.hitPoints.max` 的存储值可能只是加值，不能当作最终上限。
- 护甲物品的已标记格在 `system.armor.current`；角色 `system.armorScore` 是派生值。
- 领域卡 `inVault: false` 表示在携带区；`true` 表示保管。只有 `spell` 和 `grimoire` 卡进入 `spellcasting`，`ability` 卡仍可通过领域卡分类找到。`prepared` 在此仅表示携带状态。
- `recallCost` 是召回成本，不是施法成本；没有法术位或“已消耗”的虚构字段。

## 使用示例

参数使用原工具格式：

```json
{ "identifier": "角色的精确名称或 ID" }
```

上面交给 `get-character`。对 `search-character-items`：

```json
{ "characterIdentifier": "角色的精确名称或 ID", "category": "loadout" }
```

分类可用 `all`、`items`、`equipment`、`features`、`spells`、`domainCards`、`loadout`、`vault`、`equipped`。`spells` 包括保管库中的法术卡；只看当前携带卡时使用 `loadout`。

对 `list-creatures-by-criteria`，直接传入筛选条件，例如阶级 2 的标准敌人；图鉴索引必须启用且目标包可访问。`search-compendium` 则将这些条件放在 `filters` 中：

```json
{ "tier": 2, "adversaryType": "standard" }
```

## 构建和本地试用

要求 Node.js 24 或更新。仓库目录内执行：

```powershell
npm ci
npm run check
npm run build
npm run build:test-module
```

产物：

- `dist/test-module/module.zip`：Foundry 模块测试包。
- `dist/test-module/ninjos-foundry-mcp/`：同一模块的展开目录。
- `build/server/wrapper.js`：包含适配器的 MCP 服务端入口，需与本仓库的 `node_modules` 一起保留。
- `dist/test-module/ninjos-foundry-mcp-server-14.2609.4-daggerheart-test-win32-x64.zip`：本次构建的 Windows 服务端便携包，包含 Node 24。解压后也可将 MCP 配置的 `command` 指向包内 `node.exe`，`args` 指向包内 `app/build/server/wrapper.js`。此 ZIP 是本地适配版，不是上游原版发行包。

本次开发仅生成本地产物，没有替换已安装模块或修改 MCP 客户端配置。

试用时关闭 Foundry，备份原 `Data/modules/ninjos-foundry-mcp` 文件夹，将测试包内容放入该位置；不要改变模块 ID。测试包版本带 `-test` 标记且不含自动更新地址。打开世界，使用 GM 登录并确认模块已启用。

MCP 客户端使用标准 stdio 配置，路径替换为实际绝对路径：

```json
{
  "mcpServers": {
    "ninjos-foundry": {
      "command": "C:/path/to/node.exe",
      "args": ["C:/path/to/ninjos-foundry-mcp/build/server/wrapper.js"]
    }
  }
}
```

停止原 Ninjo 后端并重启 MCP 客户端，使新入口启动本地构建。不要同时运行旧的后台进程占用端口；按原安装文档关闭相关进程。回滚时恢复原模块备份和原服务端入口。

依次调用 `get-world-info`、`list-characters`、`get-character` 验证连接。`get-character.gameSystem.adapter` 应为 `daggerheart`，与人物卡核对数值后再使用写入功能。

## 首版边界

`roll-actor-check` 的三个系统类型通过 Foundryborne Daggerheart 的原生 `Actor#diceRoll` 执行双元骰，并在原生资源更新队列中完成 Hope、Fear、Stress 自动处理；返回值同时带有 `duality`、Hope 和 Fear 两颗骰子的结果。`custom` 掷骰仍是通用公式，不等同于系统双元骰。优势／劣势、伤害结算、升级建卡和领域卡发动仍不在本适配器的专用接口中；已有 `use-item` 会继续调用物品原生 `use` 方法，但尚未做 Daggerheart 专用回读断言。

该实现针对 Foundryborne 官方系统，不声称兼容 Simple Worldbuilding 或其他 Daggerheart 社区系统，也不声称已在旧版本系统完成验证。

## 本地验证记录

2026-09-19，使用 Node 24.20.0：

- `npm run check` 通过：类型检查、语言文件检查、公开文件检查及全套测试。192 个测试文件通过，1730 项测试通过，1 项原有测试跳过。其中新增 23 项 Daggerheart 测试。
- `npm run format:check` 通过；`git diff --check` 通过。
- `npm run build` 通过；模块测试包及包含适配器的服务端便携包已构建。
- 已验证打包后的适配器文件与服务端注册；未启动便携包或改动现有安装。
- 全套检查保留上游样式文件中已有的一条文字检查警告，无错误。未做真实世界连接测试，原因是当前桥接返回 `Foundry VTT module not connected`。

## 代码与依据

- `src/common/areas/daggerheart/adapter.ts`：字段映射与分类。
- `src/common/areas/daggerheart/adapter.test.ts`：纯数据及资源语义测试。
- `src/server/areas/daggerheart/integration.test.ts`：MCP 服务端经过模块处理器的调用测试。
- `src/module/areas/daggerheart/index.ts` 与 `src/server/areas/daggerheart/index.ts`：两端注册。
- [Ninjo v14.2609.4 源码](https://github.com/Niclasp1501/ninjos-foundry-mcp/tree/v14.2609.4)。
- [Foundryborne Daggerheart 2.9.4](https://github.com/Foundryborne/daggerheart/releases/tag/2.9.4)，字段核对的是本机该版本 `build/daggerheart.js` 和 `system.json`；测试数据为自行构造，不含用户世界数据。
