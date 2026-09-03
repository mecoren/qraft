/**
 * 快速参考数据 —— regex101 "Quick Reference" 面板的数据源
 *
 * 分类与 token 覆盖 regex101 的九大分类(Common / General Tokens / Anchors /
 * Meta Sequences / Quantifiers / Group Constructs / Character Classes /
 * Flags / Substitution),条目面向 Rust regex 引擎(不支持回溯断言与后向
 * 引用的条目已标注,并补上 Rust 扩展,如 \b{start} 系列与 (?<name>…))。
 *
 * i18n 策略:desc 为 i18n 键(tools.regex_tester.ref_<key>),面板渲染时
 * 经 t() 解析;未命中键时 parseMissingKeyHandler 会显示键名,便于发现遗漏。
 */

export interface QuickRefToken {
  /** token 语法(显示 + 插入 pattern) */
  syntax: string;
  /** 说明的 i18n 键后缀(完整键:tools.regex_tester.qr_<key>) */
  qrKey: string;
  /** 插入时把光标置于该偏移(典型:括号内),缺省置于末尾 */
  cursorOffset?: number;
}

export interface QuickRefCategory {
  /** 分类 key(i18n 分类标题键:tools.regex_tester.ref_<id>) */
  id: string;
  tokens: QuickRefToken[];
}

export const QUICK_REFERENCE: QuickRefCategory[] = [
  {
    id: 'common',
    tokens: [
      { syntax: '^', qrKey: 'anchor_start' },
      { syntax: '$', qrKey: 'anchor_end' },
      { syntax: '.', qrKey: 'any_char', cursorOffset: 0 },
      { syntax: 'a', qrKey: 'char_a' },
      { syntax: 'ab', qrKey: 'chars_ab' },
      { syntax: 'a|b', qrKey: 'alternation' },
      { syntax: 'a*', qrKey: 'zero_or_more' },
      { syntax: 'a+', qrKey: 'one_or_more' },
      { syntax: 'a?', qrKey: 'zero_or_one' },
      { syntax: '[abc]', qrKey: 'class_set' },
      { syntax: '[^abc]', qrKey: 'class_negated' },
      { syntax: '[a-z]', qrKey: 'class_range' },
      { syntax: '\\d', qrKey: 'digit' },
      { syntax: '\\w', qrKey: 'word' },
      { syntax: '\\s', qrKey: 'space' },
    ],
  },
  {
    id: 'general',
    tokens: [
      { syntax: '(?:foo)', qrKey: 'non_capturing' },
      { syntax: '(foo)', qrKey: 'capturing' },
      { syntax: '\\b', qrKey: 'word_boundary_ascii' },
      { syntax: '\\A', qrKey: 'start_text' },
      { syntax: '\\z', qrKey: 'end_text' },
    ],
  },
  {
    id: 'anchors',
    tokens: [
      { syntax: '^', qrKey: 'anchor_start' },
      { syntax: '$', qrKey: 'anchor_end' },
      { syntax: '\\A', qrKey: 'start_text' },
      { syntax: '\\z', qrKey: 'end_text' },
      { syntax: '\\b', qrKey: 'word_boundary_ascii' },
      { syntax: '\\B', qrKey: 'not_word_boundary' },
      { syntax: '\\b{start}', qrKey: 'wb_start_unicode' },
      { syntax: '\\b{end}', qrKey: 'wb_end_unicode' },
      { syntax: '\\b{start-half}', qrKey: 'wb_start_half' },
      { syntax: '\\b{end-half}', qrKey: 'wb_end_half' },
    ],
  },
  {
    id: 'meta',
    tokens: [
      { syntax: '\\d', qrKey: 'digit' },
      { syntax: '\\D', qrKey: 'not_digit' },
      { syntax: '\\w', qrKey: 'word' },
      { syntax: '\\W', qrKey: 'not_word' },
      { syntax: '\\s', qrKey: 'space' },
      { syntax: '\\S', qrKey: 'not_space' },
      { syntax: '\\pN', qrKey: 'unicode_short' },
      { syntax: '\\p{Greek}', qrKey: 'unicode_named' },
      { syntax: '[[:alpha:]]', qrKey: 'ascii_alpha' },
      { syntax: '[[:digit:]]', qrKey: 'ascii_digit_class' },
      { syntax: '[[:alnum:]]', qrKey: 'ascii_alnum' },
      { syntax: '[[:space:]]', qrKey: 'ascii_space' },
      { syntax: '[[:punct:]]', qrKey: 'ascii_punct' },
    ],
  },
  {
    id: 'quantifiers',
    tokens: [
      { syntax: 'a*', qrKey: 'zero_or_more' },
      { syntax: 'a+', qrKey: 'one_or_more' },
      { syntax: 'a?', qrKey: 'zero_or_one' },
      { syntax: 'a{3}', qrKey: 'exact_three' },
      { syntax: 'a{3,}', qrKey: 'at_least_three' },
      { syntax: 'a{3,6}', qrKey: 'bounded_three_six' },
      { syntax: 'a*?', qrKey: 'zero_or_more_lazy' },
      { syntax: 'a+?', qrKey: 'one_or_more_lazy' },
      { syntax: 'a??', qrKey: 'zero_or_one_lazy' },
      { syntax: 'a{3,6}?', qrKey: 'bounded_lazy' },
    ],
  },
  {
    id: 'groups',
    tokens: [
      { syntax: '(…)', qrKey: 'capturing', cursorOffset: 1 },
      { syntax: '(?:…)', qrKey: 'non_capturing', cursorOffset: 3 },
      { syntax: '(?<name>…)', qrKey: 'named_group', cursorOffset: 7 },
      { syntax: '(?P<name>…)', qrKey: 'named_group_py', cursorOffset: 8 },
      { syntax: '(?i)', qrKey: 'inline_flags' },
      { syntax: '(?i:…)', qrKey: 'flagged_group', cursorOffset: 4 },
      { syntax: '(?s:…)', qrKey: 'flagged_group_s', cursorOffset: 4 },
      { syntax: '(?-i:…)', qrKey: 'negated_flag_group', cursorOffset: 5 },
    ],
  },
  {
    id: 'classes',
    tokens: [
      { syntax: '[abc]', qrKey: 'class_set' },
      { syntax: '[^abc]', qrKey: 'class_negated' },
      { syntax: '[a-z]', qrKey: 'class_range' },
      { syntax: '[a-zA-Z]', qrKey: 'class_letters' },
      { syntax: '[\\d\\w]', qrKey: 'class_shorthand' },
      { syntax: '[[:alpha:][:digit:]]', qrKey: 'class_ascii_inner' },
      { syntax: '[\\p{Greek}]', qrKey: 'class_unicode_inner' },
      { syntax: '[a-y&&xyz]', qrKey: 'class_intersect' },
      { syntax: '[a-z--aeiou]', qrKey: 'class_difference' },
      { syntax: '[a-f~~d-c]', qrKey: 'class_symmetric' },
    ],
  },
  {
    id: 'flags',
    tokens: [
      { syntax: 'g', qrKey: 'flag_global' },
      { syntax: 'i', qrKey: 'flag_ignore_case' },
      { syntax: 'm', qrKey: 'flag_multiline' },
      { syntax: 's', qrKey: 'flag_dotall' },
      { syntax: 'x', qrKey: 'flag_extended' },
      { syntax: 'U', qrKey: 'flag_swap_greed' },
      { syntax: 'u', qrKey: 'flag_unicode' },
      { syntax: 'y', qrKey: 'flag_sticky' },
      { syntax: 'R', qrKey: 'flag_crlf' },
    ],
  },
  {
    id: 'substitution',
    tokens: [
      { syntax: '$1', qrKey: 'sub_group' },
      { syntax: '$<name>', qrKey: 'sub_named' },
      { syntax: '${name}', qrKey: 'sub_named_brace' },
      { syntax: '$0', qrKey: 'sub_whole' },
      { syntax: '$$', qrKey: 'sub_literal_dollar' },
    ],
  },
];
