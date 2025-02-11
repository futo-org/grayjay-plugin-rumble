const URL_BASE = "https://rumble.com";
const URL_VIDEOS = `${URL_BASE}/videos`;
const URL_SEARCH = `${URL_BASE}/search/video`;
const URL_BASE_CHANNEL = `${URL_BASE}/c/`;
const URL_BASE_CHANNEL_ALT = `${URL_BASE}/user/`;
const URL_BASE_VIDEO = `${URL_BASE}/v`;
const URL_VIDEO_DETAIL = `${URL_BASE}/embedJS/u3/`;
const URL_COMMENTS = "https://rumble.com/service.php?name=comment.list&video=";
const URL_SEARCH_CHANNEL = `${URL_BASE}/search/channel?q=`;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; rv:91.0) Gecko/20100101 Firefox/91.0';

const REGEX_HUMAN_AGO = new RegExp("([0-9]*) ([a-zA-Z]*) ago");
const REGEX_USER_IMAGE_CSS = /i.user-image--img--id-([0-9a-z]+)\s*\{\s*background-image:\s+url\("?([^"\)]+)"?\)/g;
const REGEX_USER_IMAGE = /user-image--img--id-([0-9a-z]+)/;
const REGEX_VIDEO_IMAGE_CSS = /.video-item--by-a--([0-9a-z]+)::before\s*\{\s*background-image:\s+url\("?([^"\)]+)"?\)/g;
const REGEX_VIDEO_IMAGE = /video-item--by-a--([0-9a-z]+)/;
const REGEX_VIDEO_ID = /(?:https:\/\/.+)?\/([^-]+)/;
const REGEX_VIDEO_INFO = /Rumble\("play", ({".*?),"api"/

const PLATFORM = "Rumble";
const PLATFORM_CLAIMTYPE = 4;

var config = {};

const defaultHeaders = {
	'User-Agent' : USER_AGENT
}

//Source Methods
source.enable = function (conf) {
	config = conf ?? {};
	log(config);
}
source.getHome = function () {
	return getVideosPager(URL_VIDEOS, {
		sort: "views",
		date: "today"
		//page: 1
	});
};

source.searchSuggestions = function (query) {
	return [];
};
source.getSearchCapabilities = () => {
	return {
		types: [Type.Feed.Mixed],
		sorts: [Type.Order.Chronological, "relevance", "rumbles", "views"],
		filters: [
			{
				id: "date",
				name: "Date",
				isMultiSelect: false,
				filters: [
					{ id: Type.Date.Today, name: "Today", value: "today" },
					{ id: Type.Date.LastWeek, name: "Last week", value: "this-week" },
					{ id: Type.Date.LastMonth, name: "Last month", value: "this-month" },
					{ id: Type.Date.LastYear, name: "Last year", value: "this-year" }
				]
			},
			{
				id: "duration",
				name: "Duration",
				isMultiSelect: false,
				filters: [
					{ id: Type.Duration.Short, name: "Short", value: "short" },
					{ id: Type.Duration.Long, name: "Long", value: "long" }
				]
			},
			{
				id: "license",
				name: "License",
				isMultiSelect: false,
				filters: [
					{ name: "Now", value: "now" }
				]
			}
		]
	};
}
source.search = function (query, type, order, filters) {
	let sort = order;
	if (sort === Type.Order.Chronological) {
		sort = "date";
	}

	let date = null;
	if (filters && filters["date"]) {
		date = filters["date"][0];
	}

	let duration = null;
	if (filters && filters["duration"]) {
		duration = filters["duration"][0];
	}

	let license = null;
	if (filters && filters["license"]) {
		license = filters["license"][0];
	}

	return getVideosPager(URL_SEARCH, {
		q: query,
		sort: sort,
		date: date,
		duration: duration,
		license: license
	});
};

function getChannelsPage(query, page = null) {
	const url = URL_SEARCH_CHANNEL + query + (page ? `&page=${page}` : "");
	const res = http.GET(url, defaultHeaders);
	if (!res.isOk) {
		return [];
	}

	const userImages = getUserImageList(res.body);
	const doc = domParser.parseFromString(res.body, "text/html");
	let mainAndSidebar = doc.getElementsByClassName("main-and-sidebar");
	if (!mainAndSidebar || mainAndSidebar.length < 1 || !mainAndSidebar[0]) {
		return;
	}
	mainAndSidebar = mainAndSidebar[0];

	let div = null;
	for (let i = 0; i < mainAndSidebar.childNodes.length; i++) {
		const child = mainAndSidebar.childNodes[i];
		const tagName = child.tagName;
		if (tagName === "DIV") {
			div = child;
			break;
		}
	}

	if (!div) {
		return;
	}

	const elements = div.childNodes;
	const results = [];
	let articleIndex = 0;
	for (let i = 0; i < elements.length; i++) {
		const e = elements[i];
		if (e.tagName !== "ARTICLE")
			continue;

		const a = e.querySelector("a[href]");
		const img = e.querySelector("i[data-js='user-image']");
		const h3Element = e.querySelector("h3");
		const title = h3Element?.querySelector("span");
		const spans = h3Element?.parentElement.querySelectorAll("span");
		let subscribers = spans?.[spans.length - 1];
		if (subscribers) {
			subscribers = subscribers.textContent.trim();
			if (subscribers) {
				subscribers = subscribers.replaceAll(".", "").replaceAll(",", "")
				subscribers = parseInt(subscribers.split(' ')[0])
			}
		}

		const url = a?.getAttribute("href");
		const thumbnailId = articleIndex;
		const thumbnailUrl = userImages[thumbnailId];
		const id = getAuthorIdFromUrl(url);
		const authorLink = new PlatformAuthorLink(
			id,
			title?.textContent ?? "",
			asAbsoluteURL(url),
			asAbsoluteURL(thumbnailUrl),
			subscribers
		);

		results.push(authorLink);
		articleIndex++;
	}
	const hasMoreQuery = `a[href='/search/channel?q=${query}&page=${(page ?? 1) + 1}']`;
	return { results, hasMore: doc.querySelector(hasMoreQuery) ? true : false };
}

source.searchChannels = function (query) {
	return new RumbleChannelPager({ ...getChannelsPage(query), page: 1, query });
};

//Channel
source.isChannelUrl = function (url) {
	return url.startsWith(URL_BASE_CHANNEL) || url.startsWith(URL_BASE_CHANNEL_ALT);
};
source.getChannel = function (url) {
	const res = http.GET(url, defaultHeaders);
	if (!res.isOk) {
		throw new ScriptException(`Failed to get channel (${res.status}).`);
	}

	const prefix = "channel"
	const doc = domParser.parseFromString(res.body, "text/html");
	const title = firstByTagOrNull(firstByClassOrNull(doc, `${prefix}-header--title`), "h1");
	const img = firstByClassOrNull(doc, `${prefix}-header--thumb`);
	const banner = firstByClassOrNull(doc, `${prefix}-header--backsplash-img`);
	const subscribersElement = doc.querySelector(`.${prefix}-header--title span`);

	let imageUrl = img?.getAttribute("src");
	if (!imageUrl) {
		imageUrl = firstByClassOrNull(doc, `${prefix}-header--img`)?.getAttribute("src");
	}

	const channel = new PlatformChannel({
		id: getAuthorIdFromUrl(url),
		name: title?.textContent ?? "",
		thumbnail: asAbsoluteURL(imageUrl),
		banner: banner?.getAttribute("src"),
		subscribers: extractSubCount(subscribersElement),
		description: "",
		url: url,
		links: {}
	});
	//doc.dispose();
	return channel;
};
source.getChannelContents = function (url) {
	const author = source.getChannel(url);
	const authorLink = new PlatformAuthorLink(author.id, author.name, author.url, author.thumbnail);
	return getVideosPager(url, {}, authorLink);
};

source.getChannelTemplateByClaimMap = () => {
	return {
		//Rumble
		4: {
			0: URL_BASE + "/user/{{CLAIMVALUE}}",
			1: URL_BASE + "/c/{{CLAIMVALUE}}"
		}
	};
};

//Video
source.isContentDetailsUrl = function (url) {
	return url.startsWith(URL_BASE_VIDEO);
};
source.getContentDetails = function (url) {
	const res = http.GET(url, defaultHeaders, true)
	if (res.code !== 200) {
		return null;
	}

	const doc = domParser.parseFromString(res.body, "text/html");
	const userImages = getUserImageList(res.body);

	/** @type {Array} */
	let ldJson = null;
	const scriptElements = doc.getElementsByTagName("script");

	for (let i = 0; i < scriptElements.length; i++) {
		if (scriptElements[i].getAttribute("type") === "application/ld+json") {
			ldJson = JSON.parse(scriptElements[i].text);
			break;
		}
	}

	const vidInfo = findVideoInfo(res.body)
	const vid = vidInfo.video
	if (vidInfo === null) {
		if (bridge.isLoggedIn()) {
			throw new LoginRequiredException("Subscribe to watch premium content")
		} else {
			throw new LoginRequiredException("Login to access premium content")
		}
	}
	if (vidInfo.show_premium_exclusive_gate) {
		bridge.toast("Contains premium exclusive section. Subscribe to watch premium content")
	}
	const resTracks = http.GET(`${URL_VIDEO_DETAIL}${buildQuery({
		request: "video",
		ver: 2,
		v: vid
	})}`, {}, true);

	if (resTracks.code != 200) {
		return null;
	}

	const videoDetail = JSON.parse(resTracks.body);
	const sources = [];
	const liveHeaderInfo = doc.getElementsByClassName("video-header-live-info");
	let isLive = liveHeaderInfo.length > 0 && liveHeaderInfo[0].getElementsByClassName("live-video-view-count-status").length > 0;
	let liveStream = null;
	for (const [containerName, resolutions] of Object.entries(videoDetail.ua)) {
		if (containerName == "timeline") {
			continue;
		}

		if (containerName == "hls") {
			for (const [resolution, data] of Object.entries(resolutions)) {
				const stream = new HLSSource({
					name: `Stream ${resolution}`,
					url: data.url
				});

				sources.push(stream);
				if (isLive && data.meta.live) {
					liveStream = stream;
				}
			}
		} else {
			for (const [resolution, data] of Object.entries(resolutions)) {
				sources.push(new VideoUrlSource({
					name: `Original ${resolution}P`,
					url: data.url,
					width: data.meta.w,
					height: data.meta.h,
					bitrate: data.meta.bitrate,
					duration: videoDetail.duration ?? -1,
					container: `video/${containerName}`
				}));
			}
		}
	}

	let videoObject = ldJson.find(j => j["@type"] === "VideoObject");
	const authorHref = firstByClassOrNull(doc, "media-by--a");
	const authorThumbnail = firstByClassOrNull(authorHref, "user-image");
	
	const subscribersElement = firstByClassOrNull(authorHref,`media-heading-num-followers`);
	
	const authorThumbnailUrl = userImages[getThumbnailId(authorThumbnail)];
	const thumbnailUrl = videoObject?.thumbnailUrl;
	const thumbnails = [];
	if (thumbnailUrl) {
		thumbnails.push(new Thumbnail(thumbnailUrl, 0));
	}

	const userInteractionCount = videoObject?.interactionStatistic?.userInteractionCount;
	const id = getVideoIdFromUrl(url);
	const upVotesMatch = /<span data-js="rumbles_up_votes">([^<]+)<\/span>/.exec(res.body);
	const upVotes = upVotesMatch ? upVotesMatch[1] : null;
	const downVotesMatch = /<span data-js="rumbles_down_votes">([^<]+)<\/span>/.exec(res.body);
	const downVotes = downVotesMatch ? downVotesMatch[1] : null;
	const rating = new RatingLikesDislikes(fromHumanNumber(upVotes) ?? 0, fromHumanNumber(downVotes) ?? 0);
	const subscribers = extractSubCount(subscribersElement);
	
	let description = ""
	if (videoObject.description !== "") {
		const description_child_nodes = doc.querySelector(`[data-js="media_long_description_container"]`).childNodes

		for (const [index, node] of description_child_nodes.entries()) {
			if (node.nodeType === "p") {
				description += node.innerHTML
				if (index !== description_child_nodes.length - 1) {
					description += "\n"
					description += "\n"
				}
			}
		}
	}

	//doc.dispose();

	return new PlatformVideoDetails({
		id: new PlatformID(PLATFORM, id, config.id),
		name: videoDetail.title ?? "",
		thumbnails: new Thumbnails(thumbnails),
		author: new PlatformAuthorLink(getAuthorIdFromUrl(authorHref.getAttribute("href")),
		videoDetail.author.name ?? "",
		videoDetail.author.url,
		authorThumbnailUrl ?? null,
		subscribers),
		datetime: dateToUnixTime(videoObject?.uploadDate),
		duration: videoDetail.duration ?? -1,
		viewCount: (userInteractionCount ? Number.parseInt(userInteractionCount) : 0),
		url,
		isLive,
		description,
		rating,
		video: new VideoSourceDescriptor(sources),
		live: liveStream
	});
};
source.getLiveChatWindow = function (url) {
	const res = http.GET(url, defaultHeaders);
	if (res.isOk) {
		const vid = findVideoIdInteger(res.body);

		return {
			url: "https://rumble.com/chat/popup/" + vid,
			removeElements: [".chat--header"]
		};
	}
};
source.getComments = function (url) {
	const comments = [];
	const res = http.GET(url, defaultHeaders, true);
	let lastCommentPerLevel = {};
	if (res.isOk) {
		const vid = findVideoId(res.body).substring(1);
		const commentsRes = http.GET(URL_COMMENTS + vid, defaultHeaders, true);
		if (commentsRes.isOk) {
			const obj = JSON.parse(commentsRes.body);

			const userImages = getUserImageList(obj.css_libs.global);
			const doc = domParser.parseFromString(obj.html, "text/html");
			if (doc.getElementById("sign-in-to-see-comments") && !bridge.isLoggedIn()) {
				throw new UnavailableException('Sign in to see comments')
			}

			const elements = doc.getElementsByClassName("comment-item");
			for (let i = 0; i < elements.length; i++) {
				/** @type {Element} */
				const e = elements[i];

				let isCreate = false;
				for (let i = 0; i < e.classList.length; i++) {
					if (e.classList[i] === "comments-create") {
						isCreate = true;
						break;
					}
				}

				if (isCreate) {
					continue;
				}

				const author = firstByClassOrNull(e, "comments-meta-author");
				const time = firstByClassOrNull(e, "comments-meta-post-time");
				const text = firstByClassOrNull(e, "comment-text");
				const thumbnail = firstByClassOrNull(e, "user-image--img");
				const like_count = parseInt(firstByClassOrNull(e, "rumbles-count").textContent)

				const authorThumbnailUrl = userImages[getThumbnailId(thumbnail)];
				const replyCount = e.getAttribute("data-num-replies");

				let depth = 0;
				const match = e.parentNode?.className.match(/^comments-(\d+)$/);
				if (match) {
					depth = parseInt(match[1]);

					if (isNaN(depth)) {
						depth = 0;
					} else {
						depth = depth - 1;
					}
				}

				const authorHref = asAbsoluteURL(author?.getAttribute("href"));
				const c = new RumbleComment({
					contextUrl: url,
					author: new PlatformAuthorLink(getAuthorIdFromUrl(authorHref),
						author.textContent ?? "",
						asAbsoluteURL(authorHref),
						asAbsoluteURL(authorThumbnailUrl) ?? ""),
					message: text?.textContent ?? "",
					date: extractAgoText_Timestamp(time?.textContent),
					replyCount: replyCount != null ? parseInt(replyCount) : 0,
					replies: [],
					rating: new RatingLikes(like_count)
				});

				lastCommentPerLevel[depth] = c;

				if (depth == 0) {
					comments.push(c);
				} else {
					lastCommentPerLevel[depth - 1].replies.push(c);
				}
			}
		}
	}

	return new RumbleCommentPager(comments, 20);
}

source.getUserSubscriptions = function () {
	if (!bridge.isLoggedIn()) {
		bridge.log("Failed to retrieve subscriptions page because not logged in.");
		return [];
	}

	const res = http.GET("https://rumble.com/account/channel/subscriptions", defaultHeaders, true);
	if (res.code != 200) {
		bridge.log("Failed to retrieve subscriptions page.");
		return [];
	}

	const channelUrls = [];
	const doc = domParser.parseFromString(res.body, "text/html");
	const tables = doc.getElementsByTagName("table");
	const aElements = tables[0].getElementsByTagName("a");
	bridge.log(aElements.length.toString() + " elements found");

	for (let i = 0; i < aElements.length; i++) {
		const href = aElements[i].getAttribute("href").toLowerCase();
		if (href.startsWith("/c/") || href.startsWith("/user/")) {
			channelUrls.push(asAbsoluteURL(href));
		}
	}

	bridge.log(channelUrls.length.toString() + " channels found");

	//doc.dispose();
	return channelUrls;
}

//#region Pagers
class RumbleVideoPager extends VideoPager {
	constructor(results, hasMore, url, params) {
		super(results, hasMore, { url, params });
	}

	nextPage() {
		const newParams = { ... this.context.params, page: (this.context.params.page ?? 1) + 1 };
		return getVideosPager(this.context.url, newParams);
	}
}

class RumbleCommentPager extends CommentPager {
	constructor(allResults, pageSize) {
		const end = Math.min(pageSize, allResults.length);
		const results = allResults.slice(0, end);
		const hasMore = pageSize < allResults.length;
		super(results, hasMore, {});

		this.offset = end;
		this.allResults = allResults;
		this.pageSize = pageSize;
	}

	nextPage() {
		const end = Math.min(this.offset + this.pageSize, this.allResults.length);
		this.results = this.allResults.slice(this.offset, end - this.offset);
		this.offset = end;
		this.hasMore = this.offset + this.pageSize < this.allResults.length;
		return this;
	}
}
//#endregion

//#region Parsing

/**
 * Gets the thumbnail URL for an element
 * @param {Element?} e The element
 * @returns {String?} The thumbnail URL
 */
function getThumbnailId(e) {
	if (!e) {
		return null;
	}

	for (let i = 0; i < e.classList.length; i++) {
		const className = e.classList[i];
		const match = REGEX_USER_IMAGE.exec(className);

		if (match) {
			return match[1];
		}
	}

	return null;
}

/**
 * Gets the video id from an URL
 * @param {String?} url The URL
 * @returns {String?} The video id
 */
function getVideoIdFromUrl(url) {
	if (!url) {
		return null;
	}

	const match = REGEX_VIDEO_ID.exec(url);
	return match ? match[1] : null;
}

/**
 * Gets the author id from an URL
 * @param {String?} url The URL
 * @returns {String?} The author id
 */
function getAuthorIdFromUrl(url) {
	if (!url) {
		return new PlatformID(PLATFORM, null, config.id, PLATFORM_CLAIMTYPE);
	}

	if (url.startsWith('https://rumble.com')) {
		url = url.substring('https://rumble.com'.length);
	}

	if (url.startsWith('http://rumble.com')) {
		url = url.substring('http://rumble.com'.length);
	}

	if (url.startsWith('/user/')) {
		return new PlatformID(PLATFORM, url.substring('/user/'.length), config.id, PLATFORM_CLAIMTYPE, 0);
	}

	if (url.startsWith('/c/')) {
		return new PlatformID(PLATFORM, url.substring('/c/'.length), config.id, PLATFORM_CLAIMTYPE, 1);
	}

	return new PlatformID(PLATFORM, null, config.id, PLATFORM_CLAIMTYPE);
}

/**
 * Gets the thumbnail URL for an element
 * @param {Element?} e The element
 * @returns {String?} The thumbnail URL
 */
function getAuthorThumbnailId(e) {
	if (!e) {
		return null;
	}

	for (let i = 0; i < e.classList.length; i++) {
		const className = e.classList[i];
		const match = REGEX_VIDEO_IMAGE.exec(className);

		if (match) {
			return match[1];
		}
	}

	return null;
}

/**
 * Gets a map of user images
 * @param {String} src The source
 * @returns {Map<String, String>} A user image map
 */
function getUserImageList(src) {
	const userImages = {};
	for (const userImage of src.matchAll(REGEX_USER_IMAGE_CSS)) {
		userImages[userImage[1]] = userImage[2];
	}
	return userImages;
}

/**
 * Gets a map of author images
 * @param {String} src The source
 * @returns {Map<String, String>} A author image map
 */
function getAuthorImageList(src) {
	const authorImages = {};
	for (const authorImage of src.matchAll(REGEX_VIDEO_IMAGE_CSS)) {
		authorImages[authorImage[1]] = authorImage[2];
	}
	return authorImages;
}

/**
 * Parse a HTML video-listing-entry element to a JSON element
 * @param {Document} doc HTML doc
 * @param {Map<String, String>} userImage The images map
 * @returns {PlatformVideo} Platform video
 */
function parseVideoListingEntry(authorImages, e) {
	const a = firstByClassOrNull(e, "video-item--a");
	const img = firstByClassOrNull(e, "video-item--img");
	const duration = firstByClassOrNull(e, "video-item--duration");
	const time = firstByClassOrNull(e, "video-item--time");
	const title = firstByClassOrNull(e, "video-item--title");
	const author = firstByClassOrNull(e, "video-item--by-a");
	const views = firstByClassOrNull(e, "video-item--views");
	const isLive = firstByClassOrNull(e, "video-item--live");

	const thumbnails = [];
	if (img) {
		const src = img.getAttribute("src");
		if (src) {
			thumbnails.push(new Thumbnail(src, 0));
		}
	}

	const authorHref = author?.getAttribute("href");
	const authorThumbnailUrl = authorImages[getAuthorThumbnailId(author)];

	const url = a?.getAttribute("href");
	const id = getVideoIdFromUrl(url);

	return new PlatformVideo({
		id: new PlatformID(PLATFORM, id, config.id),
		name: title?.textContent ?? "",
		thumbnails: new Thumbnails(thumbnails),
		author: new PlatformAuthorLink(getAuthorIdFromUrl(authorHref),
			author?.textContent,
			asAbsoluteURL(authorHref),
			asAbsoluteURL(authorThumbnailUrl) ?? ""),
		uploadDate: dateToUnixTime(time?.getAttribute("datetime")),
		duration: hhmmssToDuration(duration?.getAttribute("data-value")) ?? 0,
		viewCount: fromHumanNumber(views?.textContent) ?? 0,
		url: asAbsoluteURL(url),
		isLive: isLive ? true : false
	});
}

/**
 * Parse a HTML videostream element to a JSON element
 * @param {Document} doc HTML doc
 * @param {PlatformAuthorLink?} author The author of the video
 * @returns {PlatformVideo} Platform video
 */
function parseVideoStream(e, author) {
	const a = firstByClassOrNull(e, "title__link link");
	const img = firstByClassOrNull(e, "thumbnail__image");
	const duration = firstByClassOrNull(e, "videostream__status--duration");
	const time = firstByClassOrNull(e, "videostream__time");
	const title = firstByClassOrNull(e, "thumbnail__title");
	const views = firstByClassOrNull(e, "videostream__views");
	const isLive = firstByClassOrNull(e, "videostream__status--live");

	const thumbnails = [];
	if (img) {
		const src = img.getAttribute("src");
		if (src) {
			thumbnails.push(new Thumbnail(src, 0));
		}
	}

	if (!author) {
		const channelImage = firstByClassOrNull(e, "channel__image");
		const channelLink = firstByClassOrNull(e, "channel__link");
		const authorHref = channelLink?.getAttribute("href");
		const channelName = firstByClassOrNull(e, "channel__name");
		const channelImageUrl = asAbsoluteURL(channelImage?.getAttribute("style")?.match(/url\((?:'|"|)(.*?)(?:'|"|)\)/i));
		author = new PlatformAuthorLink(
			getAuthorIdFromUrl(authorHref),
			channelName?.textContent?.trim(),
			asAbsoluteURL(authorHref),
			channelImageUrl ?? ""
		);
	}

	const url = a?.getAttribute("href");
	const id = getVideoIdFromUrl(url);

	return new PlatformVideo({
		id: new PlatformID(PLATFORM, id, config.id),
		name: title?.textContent ?? "",
		thumbnails: new Thumbnails(thumbnails),
		author: author,
		uploadDate: dateToUnixTime(time?.getAttribute("datetime")),
		duration: hhmmssToDuration(duration?.textContent?.trim()) ?? 0,
		viewCount: Number.parseInt(views?.getAttribute("data-views")) ?? 0,
		url: asAbsoluteURL(url),
		isLive: isLive ? true : false
	});
}

/**
 * Parse a HTML collection video-listing-entry element to a JSON element
 * @param {Map<String, String>} authorImages The images map
 * @param {Document} doc HTML doc
 * @param {HTMLCollectionOf<Element>} elements HTML elements to parse
 * @returns {PlatformVideo[]} Platform videos
 */
function parseVideoListingEntries(authorImages, elements) {
	const res = [];
	for (let i = 0; i < elements.length; i++) {
		const e = elements[i];
		res.push(parseVideoListingEntry(authorImages, e));
	}

	return res;
}

/**
 * Parse a HTML collection video-listing-entry element to a JSON element
 * @param {Document} doc HTML doc
 * @param {HTMLCollectionOf<Element>} elements HTML elements to parse
 * @param {PlatformAuthorLink?} author The author of the video
 * @returns {PlatformVideo[]} Platform videos
 */
function parseVideoStreams(elements, author) {
	const res = [];
	for (let i = 0; i < elements.length; i++) {
		const e = elements[i];
		res.push(parseVideoStream(e, author));
	}

	return res;
}

/**
 * Retrieves the videos pager for a specific page
 * @param {String} url The base URL
 * @param {{[key: string]: any}} params Query parameters
 * @returns {RumbleVideoPager?} Videos pager
 * @param {PlatformAuthorLink?} author The author of the video
 */
function getVideosPager(url, params, author) {
	const res = http.GET(`${url}${buildQuery(params)}`, { "Cookie": `PNRC=${Math.floor(Math.random() * 312938162)}` });

	if (res.code == 200) {
		const doc = domParser.parseFromString(res.body, "text/html");

		const results = [];
		const authorImages = getAuthorImageList(res.body);
		{
			const elements = doc.getElementsByClassName("video-listing-entry");
			const r = parseVideoListingEntries(authorImages, elements);
			results.push(...r);
		}

		{
			const elements = doc.getElementsByClassName("videostream");
			const r = parseVideoStreams(elements, author);
			results.push(...r);
		}

		const page = params.page ?? 1;
		let hasMore = false;
		const nextPageElements = doc.getElementsByClassName("paginator--link");
		for (let i = 0; i < nextPageElements.length; i++) {
			const e = nextPageElements[i];
			const pageString = e?.getAttribute("aria-label");
			if (pageString == (page + 1).toString()) {
				hasMore = true;
				break;
			}
		}

		//doc.dispose();
		return new RumbleVideoPager(results, hasMore, url, params);
	}

	return new VideoPager([], false);
}

/**
 * Find the video info in a block of text.
 * @param {String} text
 */
function findVideoInfo(text) {
	const vidInfoMatch = text.match(REGEX_VIDEO_INFO)
	const vidInfo = vidInfoMatch ? JSON.parse(vidInfoMatch[1] + "}") : null
	return vidInfo
}

/**
 * Find the video id in a block of text.
 * @param {String} text
 */
function findVideoId(text) {
	const vidInfo = findVideoInfo(text)
	const vid = vidInfo ? vidInfo.video : null
	return vid
}

/**
 * Find the video id integer in a block of text.
 * @param {String} text
 */
function findVideoIdInteger(text) {
	const vidMatch = text.match(/video_id:\s(.*?),/);
	const vid = vidMatch ? vidMatch[1] : null;
	return vid;
}

//#endregion

//#region Html Parsing

/**
 * Find the first element with a class name
 * @param {Element?} e HTML element to search
 * @param {String} className Class name to find
 * @returns {Element?} The first element with that class name or null
 */
function firstByClassOrNull(e, className) {
	if (!e) {
		return null;
	}

	const elements = e.getElementsByClassName(className);
	if (!elements || elements.length == 0) {
		return null;
	}

	return elements[0];
}

/**
 * Find the first element with a tag name
 * @param {Element?} e HTML element to search
 * @param {String} tagName Tag name to find
 * @returns {Element?} The first element with that tag name or null
 */
function firstByTagOrNull(e, tagName) {
	if (!e) {
		return null;
	}

	const elements = e.getElementsByTagName(tagName);
	if (!elements || elements.length == 0) {
		return null;
	}

	return elements[0];
}

//#endregion

//#region Utility

/**
 * Convert a human number i.e. "20.1K" to a machine number i.e. 20100
 * @param {String?} numStr Human number i.e. "20.1K"
 * @returns {number?} Machine number
 */
function fromHumanNumber(numStr) {
	if (!numStr) {
		return null;
	}

	const num = parseFloat(numStr.substring(0, numStr.length - 1));
	const lastChar = numStr.charAt(numStr.length - 1).toLowerCase();
	switch (lastChar) {
		case 'b':
			return Math.round(num * 1000000000);
		case 'm':
			return Math.round(num * 1000000);
		case 'k':
			return Math.round(num * 1000);
	}

	return Math.round(num);
}

/**
 * Build a query
 * @param {{[key: string]: any}} params Query params
 * @returns {String} Query string
 */
function buildQuery(params) {
	let query = "";
	let first = true;
	for (const [key, value] of Object.entries(params)) {
		if (value) {
			if (first) {
				first = false;
			} else {
				query += "&";
			}

			query += `${key}=${value}`;
		}
	}

	return (query && query.length > 0) ? `?${query}` : "";
}

/**
 * Makes an URL absolute if not absolute already
 * @param {String?} url URL to make absolute
 * @returns {String?} Absolute URL
 */
function asAbsoluteURL(url) {
	if (!url) {
		return null;
	}

	if (url.startsWith('/')) {
		return `${URL_BASE}${url}`;
	}

	return url;
}

/**
 * Convert a Date to a unix time stamp
 * @param {String?} date Date to convert
 * @returns {number} Unix time stamp
 */
function dateToUnixTime(date) {
	if (!date) {
		return 0;
	}

	return Math.round(Date.parse(date) / 1000);
}

/**
 * Format a duration string to a duration in seconds
 * @param {String?} duration Duration string format (hh:mm:ss)
 * @returns {number} Duration in seconds
 */
function hhmmssToDuration(duration) {
	if (!duration) {
		return 0;
	}

	const parts = duration.split(':').map(Number);
	if (parts.length == 3) {
		return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
	} else if (parts.length == 2) {
		return (parts[0] * 60) + parts[1];
	} else if (parts.length == 1) {
		return parts[0];
	}

	return 0;
}

/**
 * Extract a human timestamp (1 day ago) to a number
 * @param {String?} str Timestamp format (1 day ago)
 * @returns {number} Time in seconds ago
 */
function extractAgoText_Timestamp(str) {
	if (!str) {
		return 0;
	}

	const match = str.match(REGEX_HUMAN_AGO);
	if (!match)
		return 0;
	const value = parseInt(match[1]);
	const now = parseInt(new Date().getTime() / 1000);
	switch (match[2]) {
		case "second":
		case "seconds":
			return now - value;
		case "minute":
		case "minutes":
			return now - value * 60;
		case "hour":
		case "hours":
			return now - value * 60 * 60;
		case "day":
		case "days":
			return now - value * 60 * 60 * 24;
		case "week":
		case "weeks":
			return now - value * 60 * 60 * 24 * 7;
		case "month":
		case "months":
			return now - value * 60 * 60 * 24 * 30; //For now it will suffice
		case "year":
		case "years":
			return now - value * 60 * 60 * 24 * 365;
		default:
			throw new ScriptException("Unknown time type: " + match[2]);
	}
}

/**
 * Parse subscriber count from element
 * @param {HTMLElement} subscribersElement
 * @returns {number?} Number of subscribers
 */
function extractSubCount(subscribersElement) {
	
    const subscribersText = subscribersElement?.textContent?.trim()?.toLowerCase();
	const sufix = " followers" ;
    if (!subscribersText || !subscribersText.endsWith(sufix)) {
		
        return 0; // Default to 0 if text is invalid or doesn't end with " Followers"
    }

    const subscriberCount = subscribersText.slice(0, - sufix.length).trim();
	
    try {
        const parsedCount = fromHumanNumber(subscriberCount);
		
        return parsedCount ?? 0; // Return parsed value or fallback to 0
    } catch (error) {
		log("Error parsing subscriber count " + error);
        return 0;
    }
}


class RumbleComment extends Comment {
	constructor(obj) {
		super(obj);
		this.replies = obj.replies;
	}

	getReplies() {
		return new RumbleCommentPager(this.replies, 20);
	}
}

class RumbleChannelPager extends ChannelPager {
	constructor({ results, query, page, hasMore }) {
		super(results, hasMore);
		this.query = query;
		this.page = page;
	}

	nextPage() {
		this.page = this.page + 1;
		const res = getChannelsPage(this.query, this.page);

		// for some reason Rumble will sometimes have empty search pages where
		// it says there are more results but there actually are not more results
		if (res === undefined) {
			this.results = []
			this.hasMore = false
			return this
		}

		this.results = res.results;
		this.hasMore = res.hasMore;
		return this;
	}
}

//#endregion

console.log("LOADED");
