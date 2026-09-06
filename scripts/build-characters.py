"""Build the offline character catalogue from the pinned upstream CSV."""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import unicodedata
from collections import defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA = ROOT.parent / "animadex-data-20260906"
IDENTITY_CATEGORIES = {"character_names", "wd_character", "series", "wd_copyright", "wd_artist"}
SOURCE = {
    "name": "Laxhar/noob-wiki danbooru_character.csv",
    "url": "https://huggingface.co/datasets/Laxhar/noob-wiki/tree/929c972dcc8aeecde42b7cd8931afe82cd864424",
    "revision": "929c972dcc8aeecde42b7cd8931afe82cd864424",
    "date": "2024-11-14",
    "kind": "upstream-not-live-export",
}


# Deliberately small: each entry is useful outside one named character or franchise.
# (source term, Chinese, category, subcategory, adult)
GENERAL_ROWS = [
    ("3d glasses", "3D眼镜", "accessory", "眼镜", False),
    ("accordion", "手风琴", "other", "乐器", False),
    ("adhesive bra", "粘贴式胸罩", "outfit", "内衣", False),
    ("airplane hair ornament", "飞机发饰", "accessory", "发饰", False),
    ("alpaca girl", "羊驼女孩", "character", "兽人", False),
    ("alpaca hair ornament", "羊驼发饰", "accessory", "发饰", False),
    ("alpaca tail", "羊驼尾巴", "animal", "尾巴", False),
    ("animal ears helmet", "带兽耳的头盔", "outfit", "头饰", False),
    ("antler ornament", "鹿角装饰", "accessory", "装饰", False),
    ("antlers through headwear", "穿过头饰的鹿角", "animal", "角", False),
    ("aqua cardigan", "水绿色开衫", "outfit", "上装", False),
    ("aqua eyeshadow", "水绿色眼影", "eyes", "妆容", False),
    ("aqua fur", "水绿色毛皮", "animal", "毛皮", False),
    ("aqua hoodie", "水绿色连帽衫", "outfit", "上装", False),
    ("aqua one-piece swimsuit", "水绿色连体泳衣", "outfit", "泳装", False),
    ("arched soles", "弓形脚底", "body", "脚部", False),
    ("argyle coat", "菱格纹外套", "outfit", "外套", False),
    ("argyle scarf", "菱格纹围巾", "outfit", "颈部", False),
    ("armadillo ears", "犰狳耳朵", "animal", "兽耳", False),
    ("armadillo tail", "犰狳尾巴", "animal", "尾巴", False),
    ("asymmetrical bodysuit", "不对称紧身衣", "outfit", "连体服", False),
    ("asymmetrical eyewear", "不对称眼镜", "accessory", "眼镜", False),
    ("award ribbon", "奖章绶带", "accessory", "装饰", False),
    ("backpack basket", "背篓", "accessory", "包具", False),
    ("backward facing horns", "向后弯曲的角", "animal", "角", False),
    ("badger ears", "獾耳朵", "animal", "兽耳", False),
    ("badger tail", "獾尾巴", "animal", "尾巴", False),
    ("badminton racket", "羽毛球拍", "other", "运动器材", False),
    ("baggy shorts", "宽松短裤", "outfit", "下装", False),
    ("bandaged tail", "缠绷带的尾巴", "animal", "尾巴", False),
    ("bandana over mouth", "遮住嘴的头巾", "outfit", "面部", False),
    ("bear mask", "熊面具", "accessory", "面具", False),
    ("bear paws", "熊爪", "animal", "兽爪", False),
    ("bear trap", "捕兽夹", "other", "道具", False),
    ("beige shirt", "米色衬衫", "outfit", "上装", False),
    ("bicycle helmet", "自行车头盔", "outfit", "头饰", False),
    ("bikini briefs", "比基尼三角裤", "outfit", "泳装", False),
    ("bird hat", "鸟形帽子", "outfit", "帽子", False),
    ("bird skull", "鸟类头骨", "other", "道具", False),
    ("black bikini bottom", "黑色比基尼泳裤", "outfit", "泳装", False),
    ("black pajamas", "黑色睡衣", "outfit", "睡衣", False),
    ("black track suit", "黑色运动服", "outfit", "运动服", False),
    ("blue tassel", "蓝色流苏", "accessory", "装饰", False),
    ("blue track suit", "蓝色运动服", "outfit", "运动服", False),
    ("blue wristband", "蓝色腕带", "accessory", "手部", False),
    ("boar ears", "野猪耳朵", "animal", "兽耳", False),
    ("boar hood", "野猪兜帽", "outfit", "头饰", False),
    ("boar mask", "野猪面具", "accessory", "面具", False),
    ("bone necklace", "骨制项链", "accessory", "颈饰", False),
    ("book holster", "书套", "accessory", "包具", False),
    ("boonie hat", "丛林帽", "outfit", "帽子", False),
    ("braided sidelock", "编成辫子的侧发", "hair", "发型", False),
    ("braided tail", "辫状尾巴", "animal", "尾巴", False),
    ("broken necklace", "断裂的项链", "accessory", "颈饰", False),
    ("brown eyeshadow", "棕色眼影", "eyes", "妆容", False),
    ("brown headband", "棕色发带", "accessory", "发饰", False),
    ("brown scrunchie", "棕色发圈", "accessory", "发饰", False),
    ("buckler", "小圆盾", "other", "武器", False),
    ("bunny slippers", "兔子拖鞋", "footwear", "鞋袜", False),
    ("butterfly choker", "蝴蝶颈圈", "accessory", "颈饰", False),
    ("butterfly necklace", "蝴蝶项链", "accessory", "颈饰", False),
    ("button up skirt", "纽扣裙", "outfit", "下装", False),
    ("camel ears", "骆驼耳朵", "animal", "兽耳", False),
    ("camouflage shorts", "迷彩短裤", "outfit", "下装", False),
    ("camouflage skirt", "迷彩裙", "outfit", "下装", False),
    ("camouflage trim", "迷彩镶边", "outfit", "纹样", False),
    ("cat earrings", "猫咪耳环", "accessory", "耳饰", False),
    ("cat pajamas", "猫咪睡衣", "outfit", "睡衣", False),
    ("cavalier hat", "骑士宽檐帽", "outfit", "帽子", False),
    ("championship belt", "冠军腰带", "accessory", "腰部", False),
    ("checkered bowtie", "棋盘格领结", "outfit", "颈部", False),
    ("checkered trim", "棋盘格镶边", "outfit", "纹样", False),
    ("chin piercing", "下巴穿孔", "body", "穿孔", False),
    ("chinese hat", "中式帽子", "outfit", "帽子", False),
    ("clerical collar", "牧师领", "outfit", "颈部", False),
    ("clover earrings", "四叶草耳环", "accessory", "耳饰", False),
    ("coat of arms", "纹章", "other", "标志", False),
    ("cockatiel", "玄凤鹦鹉", "animal", "鸟类", False),
    ("cold pack", "冰袋", "other", "道具", False),
    ("collar chain (jewelry)", "衣领链饰", "accessory", "颈饰", False),
    ("compression sleeve", "运动压缩袖套", "outfit", "手臂", False),
    ("concealed weapon", "隐藏武器", "other", "武器", False),
    ("conical hat", "圆锥帽", "outfit", "帽子", False),
    ("coral hair ornament", "珊瑚发饰", "accessory", "发饰", False),
    ("covered piercing", "被遮住的穿孔", "body", "穿孔", False),
    ("cow hat", "奶牛帽", "outfit", "帽子", False),
    ("cowl neck", "堆堆领", "outfit", "领口", False),
    ("crown earrings", "王冠耳环", "accessory", "耳饰", False),
    ("crown hat", "王冠帽", "outfit", "帽子", False),
    ("curled tail", "卷曲尾巴", "animal", "尾巴", False),
    ("dark green hair", "深绿色头发", "hair", "发色", False),
    ("dark red hair", "深红色头发", "hair", "发色", False),
    ("detached arm", "分离的手臂", "body", "肢体", False),
    ("detached cape", "分离式披风", "outfit", "外套", False),
    ("detached horns", "分离的角", "animal", "角", False),
    ("dice earrings", "骰子耳环", "accessory", "耳饰", False),
    ("diving helmet", "潜水头盔", "outfit", "头饰", False),
    ("dog costume", "狗狗服装", "outfit", "主题服装", False),
    ("dog hood", "狗狗兜帽", "outfit", "头饰", False),
    ("dog paws", "狗爪", "animal", "兽爪", False),
    ("donkey ears", "驴耳朵", "animal", "兽耳", False),
    ("donkey tail", "驴尾巴", "animal", "尾巴", False),
    ("doughnut hair ornament", "甜甜圈发饰", "accessory", "发饰", False),
    ("dragon costume", "龙主题服装", "outfit", "主题服装", False),
    ("dream catcher", "捕梦网", "other", "道具", False),
    ("dry suit", "干式潜水服", "outfit", "潜水服", False),
    ("duck hair ornament", "鸭子发饰", "accessory", "发饰", False),
    ("earmuffs around neck", "挂在脖子上的耳罩", "outfit", "颈部", False),
    ("elephant ears", "大象耳朵", "animal", "兽耳", False),
    ("elephant tail", "大象尾巴", "animal", "尾巴", False),
    ("extended magazine", "加长弹匣", "other", "武器配件", False),
    ("eye hair ornament", "眼睛造型发饰", "accessory", "发饰", False),
    ("eyewear around neck", "挂在脖子上的眼镜", "accessory", "眼镜", False),
    ("feather coat", "羽毛外套", "outfit", "外套", False),
    ("feather collar", "羽毛领", "outfit", "领口", False),
    ("feather necklace", "羽毛项链", "accessory", "颈饰", False),
    ("feather sleeves", "羽毛袖", "outfit", "袖子", False),
    ("ferret tail", "雪貂尾巴", "animal", "尾巴", False),
    ("fire helmet", "消防头盔", "outfit", "头饰", False),
    ("fish earrings", "鱼形耳环", "accessory", "耳饰", False),
    ("fishbowl helmet", "鱼缸头盔", "outfit", "头饰", False),
    ("fishnet armwear", "渔网袖套", "outfit", "手臂", False),
    ("fishnet swimsuit", "网眼泳衣", "outfit", "泳装", False),
    ("flamenco dress", "弗拉门戈舞裙", "outfit", "连衣裙", False),
    ("flat top chef hat", "平顶厨师帽", "outfit", "帽子", False),
    ("flight goggles", "飞行护目镜", "accessory", "眼镜", False),
    ("floral dress", "花卉连衣裙", "outfit", "连衣裙", False),
    ("flower-shaped hair", "花朵形头发", "hair", "发型", False),
    ("four-leaf clover necklace", "四叶草项链", "accessory", "颈饰", False),
    ("fox hat", "狐狸帽", "outfit", "帽子", False),
    ("french horn", "圆号", "other", "乐器", False),
    ("frilled boots", "荷叶边靴子", "footwear", "靴子", False),
    ("frilled corset", "荷叶边束身衣", "outfit", "内衣", False),
    ("frilled necktie", "荷叶边领带", "outfit", "颈部", False),
    ("frilled sweater", "荷叶边毛衣", "outfit", "上装", False),
    ("frog costume", "青蛙服装", "outfit", "主题服装", False),
    ("frog hat", "青蛙帽", "outfit", "帽子", False),
    ("frog hood", "青蛙兜帽", "outfit", "头饰", False),
    ("fur skirt", "毛皮裙", "outfit", "下装", False),
    ("gear hat ornament", "齿轮帽饰", "accessory", "帽饰", False),
    ("giant brush", "巨大画笔", "other", "道具", False),
    ("glowing arm", "发光手臂", "effects", "发光", False),
    ("glowing armor", "发光盔甲", "outfit", "盔甲", False),
    ("glowing bodysuit", "发光紧身衣", "outfit", "连体服", False),
    ("glowing ears", "发光耳朵", "effects", "发光", False),
    ("glowing tail", "发光尾巴", "effects", "发光", False),
    ("gradient bikini", "渐变色比基尼", "outfit", "泳装", False),
    ("gradient gloves", "渐变色手套", "outfit", "手套", False),
    ("green bracelet", "绿色手镯", "accessory", "手部", False),
    ("green brooch", "绿色胸针", "accessory", "胸饰", False),
    ("green innertube", "绿色游泳圈", "other", "泳具", False),
    ("green shawl", "绿色披肩", "outfit", "外套", False),
    ("green wristband", "绿色腕带", "accessory", "手部", False),
    ("grey gemstone", "灰色宝石", "accessory", "宝石", False),
    ("grey jumpsuit", "灰色连体服", "outfit", "连体服", False),
    ("grey mask", "灰色面具", "accessory", "面具", False),
    ("grey scales", "灰色鳞片", "animal", "鳞片", False),
    ("grey shawl", "灰色披肩", "outfit", "外套", False),
    ("groucho glasses", "假鼻子胡子眼镜", "accessory", "眼镜", False),
    ("gymnastics ribbon", "艺术体操彩带", "other", "运动器材", False),
    ("hamburger hat", "汉堡帽", "outfit", "帽子", False),
    ("harpoon", "鱼叉", "other", "武器", False),
    ("hat over hood", "戴在兜帽外的帽子", "outfit", "头饰", False),
    ("headphones over headwear", "戴在头饰外的耳机", "accessory", "耳机", False),
    ("heart belt", "心形腰带", "accessory", "腰部", False),
    ("hockey stick", "曲棍球杆", "other", "运动器材", False),
    ("hole in ears", "耳洞", "body", "穿孔", False),
    ("holly hat ornament", "冬青帽饰", "accessory", "帽饰", False),
    ("holographic clothing", "全息服装", "outfit", "材质", False),
    ("hooded kimono", "连帽和服", "outfit", "和服", False),
    ("hooded pajamas", "连帽睡衣", "outfit", "睡衣", False),
    ("hoop skirt", "裙撑", "outfit", "下装", False),
    ("horn hair ornament", "角形发饰", "accessory", "发饰", False),
    ("horns through hood", "穿过兜帽的角", "animal", "角", False),
    ("hummingbird", "蜂鸟", "animal", "鸟类", False),
    ("inflatable armbands", "充气臂圈", "other", "泳具", False),
    ("inflatable orca", "充气虎鲸", "other", "泳具", False),
    ("insect hair ornament", "昆虫发饰", "accessory", "发饰", False),
    ("jack (playing card)", "J纸牌", "other", "纸牌", False),
    ("jack-o'-lantern earrings", "南瓜灯耳环", "accessory", "耳饰", False),
    ("jack-o'-lantern hat ornament", "南瓜灯帽饰", "accessory", "帽饰", False),
    ("jellyfish hair ornament", "水母发饰", "accessory", "发饰", False),
    ("jingle bell earrings", "铃铛耳环", "accessory", "耳饰", False),
    ("kangaroo girl", "袋鼠女孩", "character", "兽人", False),
    ("key hair ornament", "钥匙发饰", "accessory", "发饰", False),
    ("keytar", "肩背式键盘", "other", "乐器", False),
    ("kettle helm", "桶盔", "outfit", "头饰", False),
    ("kimono dress", "和服连衣裙", "outfit", "和服", False),
    ("komainu ears", "狛犬耳朵", "animal", "兽耳", False),
    ("komainu tail", "狛犬尾巴", "animal", "尾巴", False),
    ("lace hairband", "蕾丝发带", "accessory", "发饰", False),
    ("lace shirt", "蕾丝衬衫", "outfit", "上装", False),
    ("lace-trimmed bikini", "蕾丝边比基尼", "outfit", "泳装", False),
    ("lace-up sleeves", "系带袖", "outfit", "袖子", False),
    ("layered armor", "分层盔甲", "outfit", "盔甲", False),
    ("layered capelet", "分层短披肩", "outfit", "外套", False),
    ("leather choker", "皮革颈圈", "accessory", "颈饰", False),
    ("leather shorts", "皮短裤", "outfit", "下装", False),
    ("leather vest", "皮背心", "outfit", "上装", False),
    ("light green hair", "浅绿色头发", "hair", "发色", False),
    ("lightning bolt earrings", "闪电耳环", "accessory", "耳饰", False),
    ("lightning bolt necklace", "闪电项链", "accessory", "颈饰", False),
    ("lip ring", "唇环", "body", "穿孔", False),
    ("long jacket", "长夹克", "outfit", "外套", False),
    ("long necktie", "长领带", "outfit", "颈部", False),
    ("long sword", "长剑", "other", "武器", False),
    ("loose bandages", "松散绷带", "outfit", "绷带", False),
    ("multiple bows", "多个蝴蝶结", "accessory", "装饰", False),
    ("multiple hands", "多只手", "body", "肢体", False),
    ("no arms", "无手臂", "body", "肢体", False),
    ("piglet", "小猪", "animal", "哺乳动物", False),
    ("red blindfold", "红色眼罩", "accessory", "眼部", False),
    ("reverse-jointed legs", "反关节腿", "body", "腿部", False),
    ("rhinoceros ears", "犀牛耳朵", "animal", "兽耳", False),
    ("rhinoceros girl", "犀牛女孩", "character", "兽人", False),
    ("trombone", "长号", "other", "乐器", False),
    ("waist brooch", "腰部胸针", "accessory", "腰部", False),
    ("waving arm", "挥动的手臂", "pose", "手臂动作", False),
    ("wing cape", "翅膀披风", "outfit", "外套", False),
    ("wing earrings", "翅膀耳环", "accessory", "耳饰", False),
    ("winged hairband", "翼形发带", "accessory", "发饰", False),
    ("wolf hood", "狼兜帽", "outfit", "头饰", False),
    ("x-shaped eyewear", "X形眼镜", "accessory", "眼镜", False),
    ("yellow eyeshadow", "黄色眼影", "eyes", "妆容", False),
    ("zebra ears", "斑马耳朵", "animal", "兽耳", False),
    ("zebra girl", "斑马女孩", "character", "兽人", False),
    ("zebra tail", "斑马尾巴", "animal", "尾巴", False),
]

SPECIALIZED = re.compile(
    r"(?:school|academy|gakuen|institute|college|squad|team | clan|army|naval|military|"
    r"uniform|emblem|guild|module|saint|retrofit|kamen rider|azur lane|evangelion|warcraft|"
    r"precure|gundam|project sekai|genshin impact|runescape|tokyo ghoul|one piece|yu-gi-oh|"
    r"h&k |walther |beretta |colt |kel-tec |remington |winchester |type 56|howa type|"
    r"m1918|m1895|mossberg|steyr |tokarev |webley |lee-enfield|barrett |dragunov|fn fnc|fn fal|"
    r"brodie helmet)",
    re.IGNORECASE,
)
NSFW = re.compile(
    r"(?:penis|nipples|areola|pubic hair|presenting ass|crotchless|gimp suit|bouncing penis|"
    r"goggles around breasts|necktie between pectorals|frenulum|naked suspenders)",
    re.IGNORECASE,
)


def normalize(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value or "").strip().lower().replace("_", " ").split())


def output_id(source_term: str) -> str:
    return source_term.lower().replace(" ", "_")


def digest_id(source_term: str) -> str:
    digest = hashlib.sha256(normalize(source_term).encode("utf-8")).hexdigest()[:16]
    return f"specific:{digest}"


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_DATA / "raw" / "upstream-danbooru_character.csv")
    parser.add_argument("--baseline", type=Path, default=DEFAULT_DATA / "baseline" / "local-tags.json")
    parser.add_argument("--output-root", type=Path, default=ROOT / "assets" / "数据资产")
    parser.add_argument("--expected-characters", type=int, default=33599)
    return parser.parse_args()


def build(args: argparse.Namespace) -> dict[str, int]:
    source_bytes = args.source.read_bytes()
    local_tags = json.loads(args.baseline.read_text(encoding="utf-8"))
    if not isinstance(local_tags, list):
        raise ValueError("Baseline must be a JSON array")

    exact_index: dict[str, list[dict]] = defaultdict(list)
    normalized_index: dict[str, list[dict]] = defaultdict(list)
    alias_index: dict[str, set[str]] = defaultdict(set)
    for item in local_tags:
        if item.get("category") in IDENTITY_CATEGORIES:
            continue
        exact_index[str(item.get("en", "")).strip().lower()].append(item)
        normalized_index[normalize(str(item.get("en", "")))].append(item)
        for alias in item.get("aliases", []):
            if isinstance(alias, str) and alias.isascii() and alias.strip():
                alias_index[normalize(alias)].add(str(item["id"]))

    curated = {}
    general_tags = []
    for source_term, zh, category, subcategory, nsfw in GENERAL_ROWS:
        key = normalize(source_term)
        if key in curated:
            raise ValueError(f"Duplicate curated term: {source_term}")
        en = output_id(source_term)
        curated[key] = {"en": en, "zh": zh, "aliases": [], "category": category, "subcategory": subcategory, "nsfw": nsfw}

    characters = []
    feature_stats: dict[str, dict] = {}
    raw_rows = 0
    csv.field_size_limit(10_000_000)
    with args.source.open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        required = {"character", "copyright", "trigger", "core_tags", "count"}
        missing = required - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"Missing CSV columns: {sorted(missing)}")
        for row_number, row in enumerate(reader, 2):
            raw_rows += 1
            if None in row or any(value is None for value in row.values()):
                raise ValueError(f"Malformed CSV row {row_number}")
            raw_terms = [term.strip() for term in row["core_tags"].split(",") if term.strip()]
            if not raw_terms:
                continue
            grouped: dict[str, list[str]] = {}
            for raw_term in raw_terms:
                grouped.setdefault(normalize(raw_term), []).append(raw_term)

            tag_ids = []
            specific_ids = []
            for term, raw_values in grouped.items():
                exact = []
                for raw_value in raw_values:
                    exact.extend(exact_index.get(raw_value.strip().lower(), []))
                exact = list({item["id"]: item for item in exact}.values())
                normalized_candidates = normalized_index.get(term, [])
                local_id = None
                status = "unmatched"
                candidates = []
                if len(exact) == 1:
                    local_id = str(exact[0]["id"])
                    status = "exact"
                    candidates = sorted(str(item["id"]) for item in normalized_candidates)
                elif len(normalized_candidates) == 1:
                    local_id = str(normalized_candidates[0]["id"])
                    status = "normalized"
                    candidates = [local_id]
                elif normalized_candidates:
                    status = "ambiguous_canonical"
                    candidates = sorted(str(item["id"]) for item in normalized_candidates)
                elif alias_index.get(term):
                    status = "alias_candidate" if len(alias_index[term]) == 1 else "ambiguous_alias"
                    candidates = sorted(alias_index[term])

                if local_id:
                    if local_id not in tag_ids:
                        tag_ids.append(local_id)
                    continue

                stats = feature_stats.setdefault(term, {
                    "en": term,
                    "sourceStatus": status,
                    "candidateIds": candidates,
                    "characterOccurrences": 0,
                    "rawOccurrences": 0,
                    "rawValues": set(),
                    "examples": [],
                })
                stats["characterOccurrences"] += 1
                stats["rawOccurrences"] += len(raw_values)
                stats["rawValues"].update(raw_values)
                if len(stats["examples"]) < 4:
                    stats["examples"].append(row["character"].strip())

                if term in curated:
                    general_id = curated[term]["en"].lower()
                    if general_id not in tag_ids:
                        tag_ids.append(general_id)
                else:
                    specific_id = digest_id(term)
                    if specific_id not in specific_ids:
                        specific_ids.append(specific_id)

            try:
                count = int(row["count"] or 0)
            except ValueError as exc:
                raise ValueError(f"Invalid count at CSV row {row_number}") from exc
            characters.append({
                "id": row["character"].strip(),
                "seriesId": row["copyright"].strip(),
                "trigger": row["trigger"].strip(),
                "tagIds": tag_ids,
                "specificTagIds": specific_ids,
                "count": count,
            })

    if len(characters) != args.expected_characters:
        raise ValueError(f"Expected {args.expected_characters} featured characters, found {len(characters)}")
    if len({item["id"] for item in characters}) != len(characters):
        raise ValueError("Featured character IDs are not unique")

    missing_curated = sorted(set(curated) - set(feature_stats))
    if missing_curated:
        raise ValueError(f"Curated terms are absent or already overlap the baseline: {missing_curated}")
    general_tags = sorted(curated.values(), key=lambda item: item["en"])

    specific_tags = []
    decisions = []
    specific_ids_seen = {}
    for term in sorted(feature_stats):
        stats = feature_stats[term]
        is_general = term in curated
        is_alias_review = stats["sourceStatus"] in {"alias_candidate", "ambiguous_alias", "ambiguous_canonical"}
        is_specialized = bool(SPECIALIZED.search(term))
        review = False if is_general else (is_alias_review or not is_specialized)
        if is_general:
            explanation = "可脱离特定角色或作品独立描述画面，已人工确认中文与分类"
            zh = curated[term]["zh"]
        elif is_alias_review:
            explanation = "候选别名并非可靠同义词，不自动映射，保留隐藏待复核"
            zh = ""
        elif is_specialized:
            explanation = "学校、阵营、专属制服或具名装备，仅作为角色引用保留"
            zh = ""
        else:
            explanation = "未纳入本轮人工确认的通用清单，保留隐藏待复核"
            zh = ""
        decision = {
            "en": term,
            "zh": zh,
            "decision": "general" if is_general else "specific",
            "review": review,
            "explanation": explanation,
            "sourceStatus": stats["sourceStatus"],
            "candidateIds": stats["candidateIds"],
            "characterOccurrences": stats["characterOccurrences"],
            "rawOccurrences": stats["rawOccurrences"],
            "rawValues": sorted(stats["rawValues"]),
            "examples": stats["examples"],
        }
        decisions.append(decision)
        if not is_general:
            specific_id = digest_id(term)
            previous = specific_ids_seen.setdefault(specific_id, term)
            if previous != term:
                raise ValueError(f"Specific tag digest collision: {previous!r}, {term!r}")
            specific_tags.append({
                "id": specific_id,
                "en": term,
                "zh": "",
                "category": "character_specific",
                "nsfw": bool(NSFW.search(term)),
                "review": review,
            })

    known_specific_ids = {item["id"] for item in specific_tags}
    for character in characters:
        if not all(item in known_specific_ids for item in character["specificTagIds"]):
            raise ValueError(f"Unresolved specific reference in {character['id']}")
    if any(normalize(item["en"]) in normalized_index for item in general_tags):
        raise ValueError("A general addition overlaps the baseline")

    manifest = {
        "source": SOURCE,
        "counts": {
            "characters": len(characters),
            "generalAdditions": len(general_tags),
            "specificTerms": len(specific_tags),
            "series": len({item["seriesId"] for item in characters if item["seriesId"]}),
        },
        "sourceSha256": hashlib.sha256(source_bytes).hexdigest(),
        "license": {
            "datasetCard": "Apache-2.0",
            "statements": [
                "Source attribution follows the pinned Laxhar/noob-wiki dataset card.",
                "This snapshot does not establish licensing for the complete AniMadex website or any images.",
                "No character images were copied into this catalogue.",
            ],
        },
        "build": {
            "sourceRows": raw_rows,
            "decisionTerms": len(decisions),
            "matching": "exact English first, then unique space/underscore normalization",
        },
    }

    role_dir = args.output_root / "角色"
    tag_dir = args.output_root / "标签"
    write_json(role_dir / "characters.json", characters)
    write_json(role_dir / "specific-tags.json", specific_tags)
    write_json(role_dir / "word-decisions.json", decisions)
    write_json(role_dir / "manifest.json", manifest)
    write_json(tag_dir / "character-general-tags.json", general_tags)
    return manifest["counts"]


if __name__ == "__main__":
    counts = build(parse_args())
    print(json.dumps(counts, ensure_ascii=False, sort_keys=True))
