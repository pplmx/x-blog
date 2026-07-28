/**
 * Simplified Chinese (zh-CN) translation dictionary.
 */

export const zhCn = {
	// Navigation
	"nav.home": "首页",
	"nav.about": "关于",
	"nav.tags": "标签",
	"nav.search": "搜索",
	"nav.admin": "管理",
	// Meta
	"site.title": "X-Blog - 探索技术世界",
	"site.description": "X-Blog - 探索技术世界，分享编程心得、算法解读和项目实践经验",
	// Homepage
	"home.readMore": "阅读更多",
	"home.recentPosts": "最新文章",
	"home.popularPosts": "热门文章",
	"home.noPosts": "暂无文章",
	// Post
	"post.views": "阅读",
	"post.likes": "点赞",
	"post.updated": "更新于",
	"post.published": "发布于",
	"post.tags": "标签",
	"post.relatedPosts": "相关文章",
	"post.toc": "目录",
	// Search
	"search.placeholder": "搜索文章...",
	"search.noResults": "未找到相关文章",
	"search.results": "搜索结果",
	// Comments
	"comment.title": "评论",
	"comment.placeholder": "写下你的评论...",
	"comment.nickname": "昵称",
	"comment.email": "邮箱（不公开）",
	"comment.submit": "发表评论",
	"comment.reply": "回复",
	"comment.replyTo": "回复 {name}",
	"comment.delete": "删除",
	"comment.deleteConfirm": "确定删除 {name}？{name} 的评论将被永久删除。",
	// Tags
	"tags.title": "标签列表",
	"tags.allPosts": "全部文章",
	// About
	"about.title": "关于",
	"about.intro": "X-Blog 是一个使用 FastAPI + Nuxt 构建的现代化博客系统。",
	// Error pages
	"error.notFound": "页面不存在",
	"error.goHome": "返回首页",
	// Footer
	"footer.rss": "RSS 订阅",
	"footer.copyright": "© 2024 X-Blog. All rights reserved.",
	// Common
	"common.loading": "加载中...",
	"common.prev": "上一页",
	"common.next": "下一页",
	"common.submit": "提交",
	"common.cancel": "取消",
} as const;

export type TranslationKey = keyof typeof zhCn;
