# 项目库载体接入指南

**总原则：本skill不实现任何平台的接口调用。** 读写一律委托平台已有能力，
本skill只提供表头规范和字段映射。这样既不重复造轮子，也不碰任何密钥。

## 1. 飞书电子表格（普通Sheet，最常见的形态）

用户说"飞书表格 / 云盘里的表格 / 电子表格"，**先按这个来**，别默认是多维表格。

**委托给**：`lark-unified` 技能（二进制 `lark-cli`，非meegle）。

```bash
export LARKSUITE_CLI_NO_UPDATE_NOTIFIER=1 LARKSUITE_CLI_NO_SKILLS_NOTIFIER=1  # 静音，输出才好解析

# 定位：列云盘根目录（不加 --folder-token 就是"我的空间"）
lark-cli drive files list --page-size 100 --as user -q '.data.files[] | {name, type, token}'
# type=sheet 是电子表格，type=bitable 是多维表格，type=folder 是文件夹

# 看有哪些工作表（拿 sheet_id）
lark-cli sheets +workbook-info --spreadsheet-token <token> --as user

# 读
lark-cli sheets +cells-get --spreadsheet-token <t> --sheet-name "项目库" --range "A1:V50" --as user \
  -q '.data.ranges[0].cells[][] | .value // ""'

# 写（--cells 用 @文件，长文本里的换行才不会丢）
lark-cli sheets +cells-set --spreadsheet-token <t> --sheet-id <id> --range A1 --cells @cells.json --as user
#   cells.json 是 [[{"value":"..."},...],...] 的二维数组
#   --range 只给左上角当锚点（如 A1），数组尺寸决定写入范围

# 建工作表 / 改结构
lark-cli sheets +sheet-create  --spreadsheet-token <t> --title "看法流水" --col-count 9 --row-count 500 --as user
lark-cli sheets +sheet-rename  --spreadsheet-token <t> --sheet-id <id> --title "项目库" --as user
lark-cli sheets +dim-insert    --spreadsheet-token <t> --sheet-id <id> --position U --count 2 --as user

# 美化 / 冻结 / 隐藏
lark-cli sheets +styles-put    --spreadsheet-token <t> --styles @styles.json --as user
lark-cli sheets +dim-hide      --spreadsheet-token <t> --sheet-id <id> --range 2:2 --as user
```

**电子表格版的表头约定**（本skill在飞书Sheet上落地的实际做法）：

- 第1行 = **中文标签**（给人看）
- 第2行 = **英文标准名**（给AI读，用来防用户改中文列名后mapping失效），**隐藏这一行**
- 数据从第3行开始；冻结前2行
- 长文本列开 `word_wrap`，行高 `auto`，列宽300px上下
- `--cells` 一律走 `@文件`，不要用命令行内联JSON（换行和引号会炸）

## 2. 飞书多维表格（功能最全）

**委托给**：`lark-unified` / `lark-base` 技能。

```bash
# 读记录
lark-cli base +record-list --app-token <表格token> --table-id <表id>
# 新增记录
lark-cli base +record-create --app-token <x> --table-id <x> --fields '<json>'
# 更新记录
lark-cli base +record-update --app-token <x> --table-id <x> --record-id <x> --fields '<json>'
```

- 首次使用需要申请授权范围：`base:record:read base:table:read base:field:read`（读）
  写入再加 `base:record:create base:record:update`
- 建表建议两张数据表：`项目库` + `看法流水`，字段类型都用"文本"或"多行文本"，
  日期字段用"日期"类型
- 表头照抄 `assets/headers-main.csv` / `assets/headers-log.csv` 的**第二行中文**

## 3. 钉钉AI表格 / 在线表格

**委托给**：`dingtalk-unified` 技能（底层是 `dws`）。

```bash
dws aitable --help        # AI 表格/多维表：Base、数据表、字段、记录、视图、仪表盘
dws sheet --help          # 普通在线表格：工作表、单元格区域读写（动态域，先查 help）
```

选型口诀（来自dws官方路由）：
- 用户说"表格/在线表格/Sheet/单元格"且没有字段记录语义 → `sheet`
- 用户说"AI表格/多维表/Base/记录/字段/视图" → `aitable`

**写操作前先查 `dws <域> --help`**，别凭记忆敲命令。

## 4. 本地Excel / CSV

**自己处理**，用 `scripts/init_sheet.py` 建库，读写用Python `openpyxl`（已验证可用）或内置csv模块。

- 建库：`python scripts/init_sheet.py --out "文档/项目库.xlsx"`
  会生成两张工作表：`项目库` 和 `看法流水`
- 追加一行：读 → 追加 → 写回。**注意文件被Excel打开着会写失败**，先提醒用户关掉
- 路径问用户要，不要自己挑位置

## 5. 腾讯文档在线表格

**委托给**：`tencent-docs` / `tencent-docs-sheetagent` 技能。

## 6. 字段映射（必做）

用户的表格列名几乎不可能跟标准英文名一致。读进来时先做一次映射：

| 用户可能的列名 | 标准字段 |
|---|---|
| 公司名 / 项目名称 / 标的 / 企业 | `company` |
| 赛道 / 行业 / 领域 / 方向 | `industry` |
| 轮次 / 融资阶段 / 本轮 | `round` |
| 状态 / 进度 / 推进情况 | `status` |
| 来源 / 谁推的 / 渠道 | `sourceType` |
| 打分 / 评分 / 意向度 | `score` |
| 投资逻辑 / 亮点 / 核心逻辑 | `thesis` |
| 看法 / 我的判断 / 观点 | `myView` |
| 预测 / 我预计 / 判断依据 | `expect` |

**映射不上的列不要扔掉**，原样保留并在看板里忽略，同时提醒用户有未识别的列。

## 7. 找不到项目库时

用户说不清表在哪 / 链接失效 / 文件不存在：

1. 先问有没有备份或导出文件
2. 都没有 → 提议用 `init_sheet.py` 建一个新库
3. **绝不自己默默建一个空库然后假装数据存在**
