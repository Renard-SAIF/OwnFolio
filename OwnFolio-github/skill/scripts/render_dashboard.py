#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""投资看板生成器：标准 JSON → 自包含单文件 HTML。

用法:
    python render_dashboard.py --data data.json --out 看板.html
    python render_dashboard.py --demo --out 示例看板.html      # 生成示例看板看效果

所有指标都在这里按 references/analysis-rules.md 算好，模板里的 JS 只负责画图。
AI 不要自己算数，跑这个脚本。
"""

import argparse
import calendar
import json
import os
import re
import sys
from datetime import date, datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATE = os.path.join(os.path.dirname(HERE), 'assets', 'dashboard-template.html')

STATUS_ORDER = ['初次接触', '持续观察', '深度尽调', '已过投委会',
                '已出投资意向书', '已投', '已放弃']
STATUS_COLOR = {
    '初次接触': '#98a2b3', '持续观察': '#b78103', '深度尽调': '#1d4ed8',
    '已过投委会': '#1d4ed8', '已出投资意向书': '#1d4ed8',
    '已投': '#0f6e56', '已放弃': '#a52d2d',
}
VERIFIED = ('中了', '没中')
CLOSED = ('已投', '已放弃')


# ---------- 日期工具 ----------
def parse_date(s):
    """识别不了的日期返回 None，交给调用方兜底，不抛异常。"""
    if not s:
        return None
    s = str(s).strip()
    try:
        return datetime.strptime(s, '%Y-%m-%d').date()
    except ValueError:
        pass
    for sep in ('/', '.', '-'):
        try:
            return datetime.strptime(s, '%Y' + sep + '%m' + sep + '%d').date()
        except ValueError:
            pass
    if re.fullmatch(r'\d{8}', s):
        try:
            return date(int(s[:4]), int(s[4:6]), int(s[6:8]))
        except ValueError:
            return None
    m = re.match(r'(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日', s)
    if m:
        try:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            return None
    return None


def months_ago(d, n):
    y, m = d.year, d.month - n
    while m <= 0:
        m += 12
        y -= 1
    return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


def quarter_label(d):
    return '%dQ%d' % (d.year, (d.month - 1) // 3 + 1)


def num(v):
    """把兴趣度之类的值转成 1-5 的整数，转不了返回 None。"""
    try:
        n = int(str(v).strip())
        return n if 1 <= n <= 5 else None
    except (ValueError, TypeError, AttributeError):
        return None


def s(v):
    return '' if v is None else str(v).strip()


# ---------- 计算 ----------
def compute(raw, today=None):
    today = today or date.today()
    projects = [p for p in (raw.get('projects') or []) if s(p.get('company'))]
    views = [v for v in (raw.get('views') or []) if s(v.get('company'))]

    # 同一个公司多行时保留 updatedAt 最新的
    dedup = {}
    for p in projects:
        c = s(p.get('company'))
        prev = dedup.get(c)
        if prev is None or s(p.get('updatedAt')) >= s(prev.get('updatedAt')):
            dedup[c] = p
    projects = list(dedup.values())

    total = len(projects)
    invested = sum(1 for p in projects if s(p.get('status')) == '已投')

    scores = [n for n in (num(p.get('score')) for p in projects) if n]
    avg_score = round(sum(scores) / len(scores), 1) if scores else None

    # 命中率：只看流水表里已回填结果的
    done = [v for v in views if s(v.get('result')) in VERIFIED]
    hit = sum(1 for v in done if s(v.get('result')) == '中了')
    hit_rate = round(hit * 100 / len(done)) if done else None
    pending = sum(1 for v in views if s(v.get('result')) not in VERIFIED)

    # 该跟进了
    follow = []
    for p in projects:
        if s(p.get('status')) in CLOSED:
            continue
        d = parse_date(p.get('nextFollow'))
        if not d:
            continue
        if d <= today:
            follow.append({'company': s(p.get('company')), 'nextFollow': d.isoformat(),
                           'overdue': True, 'days': (today - d).days})
        elif d <= today + timedelta(days=7):
            follow.append({'company': s(p.get('company')), 'nextFollow': d.isoformat(),
                           'overdue': False, 'days': (d - today).days})
    follow.sort(key=lambda x: (not x['overdue'], x['days']))

    def dist(key, top=None):
        m = {}
        for p in projects:
            k = s(p.get(key)) or '未填'
            m[k] = m.get(k, 0) + 1
        out = [{'name': k, 'n': v} for k, v in m.items()]
        out.sort(key=lambda x: -x['n'])
        if top and len(out) > top:
            head, tail = out[:top - 1], out[top - 1:]
            out = head + [{'name': '其他', 'n': sum(x['n'] for x in tail)}]
        return out

    industry = dist('industry', top=9)
    status_map = {s(p.get('status')): 0 for p in projects}
    for p in projects:
        status_map[s(p.get('status'))] = status_map.get(s(p.get('status')), 0) + 1
    status_funnel = [{'name': k, 'n': status_map.get(k, 0),
                      'color': STATUS_COLOR.get(k, '#98a2b3')}
                     for k in STATUS_ORDER if status_map.get(k)]

    # 季度
    qmap = {}
    for p in projects:
        d = parse_date(p.get('meetDate')) or parse_date(p.get('createdAt'))
        if not d:
            continue
        lab = quarter_label(d)
        e = qmap.setdefault(lab, {'label': lab, 'n': 0, 'scores': []})
        e['n'] += 1
        n = num(p.get('score'))
        if n:
            e['scores'].append(n)
    quarters = []
    for lab in sorted(qmap)[-8:]:
        e = qmap[lab]
        quarters.append({'label': lab, 'n': e['n'],
                         'avg': round(sum(e['scores']) / len(e['scores']), 1) if e['scores'] else None})

    # 赛道分组
    tracks = {}
    for p in projects:
        tracks.setdefault(s(p.get('industry')) or '未填', []).append(p)
    for k in tracks:
        # 口径：兴趣度从高到低；同分时交流日期新的在前。
        # Python 排序是稳定的，先排日期降序、再排分数降序即可得到想要的复合顺序。
        tracks[k].sort(key=lambda p: s(p.get('meetDate')), reverse=True)
        tracks[k].sort(key=lambda p: -(num(p.get('score')) or 0))
    track_names = sorted(tracks.keys(), key=lambda k: (-len(tracks[k]), k))

    # 时间胶囊
    company_status = {s(p.get('company')): s(p.get('status')) for p in projects}
    capsule = {}
    for n in (6, 12, 24):
        start = months_ago(today, n)
        end = start + timedelta(days=90)
        rows = []
        for v in views:
            d = parse_date(v.get('at'))
            if not d or not (start <= d <= end):
                continue
            res = s(v.get('result'))
            if res in VERIFIED:
                later = '预测' + res
                if res == '没中' and s(v.get('missReason')):
                    later += '：' + s(v.get('missReason'))
            else:
                st = company_status.get(s(v.get('company')))
                later = ('现在是「%s」' % st) if st else '项目库里已经没有这家了'
            rows.append({'company': s(v.get('company')), 'at': d.isoformat(),
                         'view': s(v.get('view')), 'expect': s(v.get('expect')),
                         'later': later})
        rows.sort(key=lambda r: r['at'])
        capsule[str(n)] = rows

    hits = []
    for v in views:
        if s(v.get('result')) in VERIFIED:
            hits.append({'company': s(v.get('company')), 'at': s(v.get('at')),
                         'expect': s(v.get('expect')), 'result': s(v.get('result')),
                         'missReason': s(v.get('missReason'))})
    hits.sort(key=lambda r: r['at'])

    return {
        'meta': {'generatedAt': today.isoformat(),
                 'source': s((raw.get('meta') or {}).get('source')),
                 'total': total},
        'metrics': {'total': total, 'invested': invested,
                    'avgScore': avg_score, 'hitRate': hit_rate,
                    'hitDone': len(done), 'pending': pending},
        'follow': follow,
        'industry': industry,
        'statusFunnel': status_funnel,
        'quarters': quarters,
        'tracks': {k: tracks[k] for k in track_names},
        'trackNames': track_names,
        'trackNotes': {},
        'capsule': capsule,
        'hits': hits,
        'projects': projects,
    }


# ---------- 示例数据 ----------
def demo_data(today=None):
    today = today or date.today()
    def ago(days):
        return (today - timedelta(days=days)).isoformat()
    return {
        'meta': {'source': '示例数据（不是你的真实项目）'},
        'projects': [
            {'company': '示例·灵巧手公司', 'industry': '具身智能', 'round': 'A轮',
             'status': '深度尽调', 'sourceType': '融资顾问推送', 'sourceDetail': '示例机构',
             'score': '4', 'thesis': '灵巧手是人形机器人量产的成本卡点，自研六维力传感器',
             'meetDate': ago(120), 'financing': '本轮 2 亿，估值 12 亿',
             'credibility': '部分验证', 'myView': '工程化能力强，但客户集中度偏高',
             'concernResult': '未验证', 'nextFollow': ago(5),
             'createdAt': ago(120), 'updatedAt': ago(30)},
            {'company': '示例·量子计算公司', 'industry': '量子计算', 'round': 'Pre-A轮',
             'status': '持续观察', 'sourceType': '主动挖掘', 'score': '3',
             'thesis': '超导路线稀缺标的，团队来自中科院', 'meetDate': ago(200),
             'financing': '上轮 5000 万', 'myView': '短期看工程化，中期看纠错路线',
             'concernResult': '还没发生', 'nextFollow': ago(40),
             'createdAt': ago(200), 'updatedAt': ago(40)},
            {'company': '示例·AI数据公司', 'industry': 'AI应用', 'round': 'C+轮',
             'status': '已投', 'sourceType': '已投公司推荐', 'score': '5',
             'thesis': '后训练数据市场大，已获头部模型公司背书并持续复购',
             'meetDate': ago(300), 'financing': '本轮 1 亿美元，估值 10 亿美元',
             'myView': '数据供应商的壁垒在渠道和专家网络，不在技术',
             'concernResult': '中了', 'createdAt': ago(300), 'updatedAt': ago(10)},
            {'company': '示例·脑机接口公司', 'industry': '脑机接口', 'round': '天使轮',
             'status': '已放弃', 'sourceType': '行业会议', 'score': '2',
             'thesis': '侵入式路线，临床周期太长', 'meetDate': ago(400),
             'dropReason': '估值与临床进度不匹配', 'myView': '技术团队不错但商业化太远',
             'concernResult': '没中', 'missReason': '当时判断客户一年内落地，实际采购流程慢很多',
             'createdAt': ago(400), 'updatedAt': ago(400)},
        ],
        'views': [
            {'company': '示例·AI数据公司', 'at': ago(700), 'stage': '初次接触', 'score': '4',
             'view': '刚接触，数据标注看着像人力生意，没看出壁垒在哪',
             'expect': '这门生意会被模型能力进步吃掉', 'result': '没中',
             'missReason': '低估了专家网络和数据闭环的价值，后来他们拿到了头部模型公司的复购',
             'source': '第一次访谈'},
            {'company': '示例·灵巧手公司', 'at': ago(120), 'stage': '初次接触', 'score': '3',
             'view': '刚接触，六维力传感器自研是真亮点', 'expect': '半年内出工程样机',
             'result': '中了', 'source': '第一次访谈'},
            {'company': '示例·灵巧手公司', 'at': ago(30), 'stage': '深度尽调', 'score': '4',
             'view': '样机出来了，但客户集中度偏高，前两大客户占七成',
             'expect': '今年内会再融一轮', 'result': '', 'source': '第二次访谈'},
            {'company': '示例·AI数据公司', 'at': ago(300), 'stage': '深度尽调', 'score': '5',
             'view': '数据供应商本质是专家网络的中转站，壁垒在渠道不在技术',
             'expect': '半年内拿到第二家头部模型公司订单', 'result': '中了',
             'source': '尽调会'},
            {'company': '示例·脑机接口公司', 'at': ago(400), 'stage': '持续观察', 'score': '2',
             'view': '技术团队不错，但商业化太远',
             'expect': '一年内会有临床突破', 'result': '没中',
             'missReason': '当时判断客户一年内落地，实际采购流程比预想慢很多',
             'source': '行业会议'},
        ],
    }


# ---------- 主流程 ----------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', help='标准 JSON 文件路径')
    ap.add_argument('--demo', action='store_true', help='生成示例看板')
    ap.add_argument('--out', required=True, help='输出 HTML 路径')
    args = ap.parse_args()

    if args.demo:
        raw = demo_data()
    elif args.data:
        with open(args.data, 'r', encoding='utf-8') as f:
            raw = json.load(f)
        if not isinstance(raw, dict):
            print('JSON 顶层必须是对象')
            return 1
    else:
        print('要给 --data 或 --demo')
        return 1

    computed = compute(raw)

    with open(TEMPLATE, 'r', encoding='utf-8') as f:
        html = f.read()

    payload = json.dumps(computed, ensure_ascii=False)
    # 防止数据里出现 </script> 把页面截断
    payload = payload.replace('</', '<\\/')
    html = html.replace('__DASHBOARD_DATA__', payload)

    out = os.path.abspath(args.out)
    parent = os.path.dirname(out)
    if parent and not os.path.isdir(parent):
        os.makedirs(parent, exist_ok=True)
    with open(out, 'w', encoding='utf-8') as f:
        f.write(html)

    m = computed['metrics']
    print('已生成 %s' % out)
    print('项目 %d 个 · 已投 %d · 平均兴趣度 %s · 命中率 %s（已验 %d 次）'
          % (m['total'], m['invested'],
             m['avgScore'] if m['avgScore'] is not None else '—',
             (str(m['hitRate']) + '%') if m['hitRate'] is not None else '—',
             m['hitDone']))
    return 0


if __name__ == '__main__':
    sys.exit(main())
