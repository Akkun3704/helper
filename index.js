const fs = require('fs')
const path = require('path')
const axios = require('axios')
const morgan = require('morgan')
const fakeua = require('fake-ua')
const cheerio = require('cheerio')
const express = require('express')
const PDFDocument = require('pdfkit')
const getStream = require('get-stream')

const tmpFolder = path.join(__dirname, './tmp')
const PORT = process.env.PORT || ~~(Math.random() * 1e4)
const app = express()

app.set('json spaces', 2)
app.use(morgan('tiny'))
app.use(express.json())
// app.use(express.urlencoded({ extended: true }))

app.use((req, res, next) => {
	clearTmp()
	next()
})

app.get('/', (req, res) => {
	let baseUrl = `https://${req.get('host')}`
	res.json({
		runtime: new Date(process.uptime() * 1000).toTimeString().split(' ')[0],
		result: {
			doujindesu: {
				latest: `${baseUrl}/doujindesu/latest`,
				search: `${baseUrl}/doujindesu/search?q=school`,
				detail: `${baseUrl}/doujindesu/detail?url=https://212.32.226.234/manga/a-wonderful-new-world`
			},
			nhentai: {
				latest: `${baseUrl}/nhentai`,
				detail: `${baseUrl}/nhentai?code=353331`,
				download: `${baseUrl}/nhentai/353331`
			},
			tools: {
				buffer: `${baseUrl}/buffer?url=https://i.waifu.pics/dQ8bv0m.png`,
				fetch: `${baseUrl}/fetch?url=${baseUrl}`,
				igstalk: `${baseUrl}/igstalk?user=otaku_anime_indonesia`,
				ssweb: `${baseUrl}/ss?url=${baseUrl}&full=false&type=desktop`
			}
		}
	})
})

app.post('/imagetopdf', async (req, res) => {
	try {
		// console.log(req.body)
		let { images, filename } = req.body
		if (!images) return res.json({ message: 'Required an image url' })
		if (!(filename && filename.endsWith('.pdf'))) filename = `${~~(Math.random() * 1e9)}.pdf`
		let buffer = await toPDF(images)
		console.log(images.length, filename)
		fs.writeFileSync(path.join(tmpFolder, filename), buffer)
		res.json({ result: `https://${req.get('host')}/download/${filename}` })
	} catch (e) {
		res.json({ message: String(e) })
	}
})

app.get('/fetch', async (req, res) => {
	try {
		if (!req.query.url) return res.json({ message: 'Required an url' })
		let json = await axios.get(req.query.url)
		res.json(json.data)
	} catch (e) {
		res.send(e)
	}
})

app.get('/buffer', async (req, res) => {
	try {
		if (!req.query.url) return res.json({ message: 'Required an url' })
		let data = await axios.get(req.query.url, { responseType: 'arraybuffer' })
		res.set({
			'Content-Type': data.headers['content-type'] || data.headers['Content-Type'],
			'Content-Length': data.data.length
		})
		res.end(data.data)
	} catch (e) {
		res.send(e)
	}
})

app.get(['/ss', '/ssweb'], async (req, res) => {
	try {
		let { url, full, type } = req.query
		if (!url) return res.json({ message: 'Required an url' })
		let data = await ssweb(url, full, type)
		res.end(data)
	} catch (e) {
		res.send(e)
	}
})

app.get('/igstalk', async (req, res) => {
	try {
		if (!req.query.user) return res.json({ message: 'Required an username' })
		let result = await igStalk(req.query.user)
		res.json({ result })
	} catch (e) {
		res.send(e)
	}
})

app.get('/nhentai', async (req, res) => {
	try {
		if (req.query.code) {
			let data = await nhentaiScraper(req.query.code)
			if (!data) return res.json({ message: 'Code not exists' })
			let img = data.images, images = {}
			delete data.images
			images.cover = images.thumbnail = `https://external-content.duckduckgo.com/iu/?u=https://t.nhentai.net/galleries/${data.media_id}/thumb.jpg`, images.pages = []
			img.pages.map((v, i) => {
				let ext = new URL(v.t).pathname.split('.')[1]
				images.pages.push(`https://external-content.duckduckgo.com/iu/?u=https://i.nhentai.net/galleries/${data.media_id}/${i + 1}.${ext}`)
			})
			return res.json({ result: { ...data, images }})
		}
		let data = (await nhentaiScraper()).all, result = []
		for (let x of data) result.push({
			id: x.id, title: x.title, pages: x?.num_pages || '',
			cover: x.cover?.t?.replace(/a.|b./, 'c.') || x.cover?.replace(/a.|b./, 'c.')
		})
		res.json({ result })
	} catch (e) {
		res.send(e)
	}
})

app.get('/nhentai/:code', async (req, res) => {
	try {
		let data = await nhentaiScraper(req.params.code), pages = []
		if (!data) return res.json({ message: 'Code not exists' })
		data.images.pages.map((v, i) => {
			let ext = new URL(v.t).pathname.split('.')[1]
			pages.push(`https://external-content.duckduckgo.com/iu/?u=https://i7.nhentai.net/galleries/${data.media_id}/${i + 1}.${ext}`)
		})
		let buffer = await toPDF(pages), filename = `${data.id}.pdf`
		fs.writeFileSync(path.join(tmpFolder, filename), buffer)
		res.json({ result: `https://${req.get('host')}/download/${filename}` })
	} catch (e) {
		res.json({ message: String(e) })
	}
})

app.get('/doujindesu/:type', async (req, res) => {
	try {
		if (/^latest$/i.test(req.params.type)) {
			let result = await doujindesuScraper()
			return res.json({ result })
		} else if (/^search$/i.test(req.params.type)) {
			if (!req.query.q) return res.json({ message: 'Input parameter q' })
			let result = await doujindesuScraper('search', req.query.q)
			return res.json({ result })
		} else if (/^download$/i.test(req.params.type)) {
			if (!req.query.url) return res.json({ message: 'Required doujindesu url' })
			let data = await doujindesuScraper('download', req.query.url)
			let buffer = await toPDF(data.pages), filename = `${encodeURIComponent(data.title)}.pdf`
			fs.writeFileSync(path.join(tmpFolder, filename), buffer)
			return res.json({ result: `https://${req.get('host')}/download/${filename}` })
		} else if (/^detail$/i.test(req.params.type)) {
			if (!req.query.url) return res.json({ message: 'Required doujindesu url' })
			let result = await doujindesuScraper('detail', req.query.url.endsWith('/') ? req.query.url : req.query.url + '/')
			return res.json({ result })
		}
	} catch (e) {
		res.send(e)
	}
})

app.get('/download/:path', async (req, res) => {
	try {
		let filename = req.params.path
		res.download(path.join(tmpFolder, encodeURIComponent(filename)), filename)
	} catch (e) {
		res.json({ message: String(e) })
	}
})

app.listen(PORT, () => {
	console.log('App running on port', PORT)
})

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms))
}

function clearTmp() {
	let filename = []
	fs.readdirSync(tmpFolder).forEach(file => filename.push(path.join(tmpFolder, file)))
	return filename.map(file => {
		let stats = fs.statSync(file)
		if (stats.isFile() && (Date.now() - stats.mtimeMs >= 1000 * 60 * 3)) {
			console.log('Deleted file', file)
			return fs.unlinkSync(file)
		}
		return false
	})
}

function toPDF(images, opt = {}) {
	return new Promise(async (resolve, reject) => {
		if (!Array.isArray(images)) images = [images]
		let buffs = [], doc = new PDFDocument({ margin: 0, size: 'A4' })
		for (let x = 0; x < images.length; x++) {
			if (/.webp|.gif/.test(images[x])) continue
			let data = (await axios.get(images[x], { responseType: 'arraybuffer', ...opt })).data
			doc.image(data, 0, 0, { fit: [595.28, 841.89], align: 'center', valign: 'center' })
			if (images.length != x + 1) doc.addPage()
		}
		doc.on('data', (chunk) => buffs.push(chunk))
		doc.on('end', () => resolve(Buffer.concat(buffs)))
		doc.on('error', (err) => reject(err))
		doc.end()
	})
}

async function ssweb(url, full = false, type = 'desktop') {
	type = type.toLowerCase()
	if (!/desktop|tablet|phone/.test(type)) type = 'desktop'
	let form = new URLSearchParams
	form.append('url', url)
	form.append('device', type)
	if (!!full) form.append('full', 'on')
	form.append('cacheLimit', 0)
	let res = await axios.post('https://www.screenshotmachine.com/capture.php', form)
	let buffer = await axios.get(`https://www.screenshotmachine.com/${res.data.link}`, {
		responseType: 'arraybuffer',
		headers: {
			'cookie': res.headers['set-cookie'].join('')
		}
	})
	return Buffer.from(buffer.data)
}

async function igStalk(user) {
	const getDetailPost = async url => {
		let html = (await axios.get(url, { headers: { 'Referer': 'https://www.picuki.com/', 'User-Agent': fakeua.mobile() }})).data 
		let $ = cheerio.load(html), obj = {}
		obj.caption = $('title').text().trim().split(' Instagram post ')[1].split(' - Picuki.com')[0]
		obj.ago = $('div.single-photo-info').find('div.single-photo-time').text()
		obj.likes = $('div.info-bottom').find('span.icon-thumbs-up-alt').text()
		obj.comments = $('div.info-bottom').find('span.icon-chat').text()
		obj.url = $('div.single-photo.owl-carousel.owl-theme > div.item').get().map((x) => $(x).find('img').attr('src') || $(x).find('video').attr('src'))
		if (!obj.url.length) obj.url = [$('div.single-photo').find('img').attr('src') || $('div.single-photo').find('video').attr('src')]
		return obj
	}
	let html = (await axios.get('https://www.picuki.com/profile/' + user, { headers: { 'Referer': 'https://www.picuki.com/', 'User-Agent': fakeua.mobile() }})).data
	let $ = cheerio.load(html), obj = {}, arr = []
	let urlPost = $('div.content > ul > li').get().map((x) => $(x).find('a').attr('href'))
	for (let x of urlPost) arr.push(await getDetailPost(x))
	obj.avatar = $('div.profile-avatar').find('a').attr('href')
	obj.username = $('div.profile-name > h1').text()
	obj.fullname = $('div.profile-name > h2').text()
	obj.description = $('div.profile-description').text().trim()
	obj.followers = $('div.content-title').find('span.followed_by').text()
	obj.following = $('div.content-title').find('span.follows').text()
	obj.post = arr
	return obj
}

async function nhentaiScraper(id) {
	let uri = id ? `https://cin.guru/v/${+id}/` : 'https://cin.guru/'
	let html = (await axios.get(uri)).data
	return JSON.parse(html.split('<script id="__NEXT_DATA__" type="application/json">')[1].split('</script>')[0]).props.pageProps.data
}

async function doujindesuScraper(type = 'latest', query) {
	let uri = /^latest$/i.test(type) ? 'https://212.32.226.234/' : /^search$/i.test(type) ? `https://212.32.226.234/?s=${query}` : query
	if (/^latest$/i.test(type)) {
		let html = (await axios.get(uri)).data, $ = cheerio.load(html), arr = []
		$('div.entries > article.entry').each((idx, el) => arr.push({
			title: $(el).find('a').attr('title'),
			chapter: $(el).find('div.artists > a').attr('title').split(' Chapter ')[1],
			type: $(el).find('span.type').text(),
			cover: $(el).find('img').attr('src'),
			url: 'https://212.32.226.234' + $(el).find('a').attr('href')
		}))
		return arr
	} else if (/^search$/i.test(type)) {
		let html = (await axios.get(uri)).data, $ = cheerio.load(html), arr = []
		$('div.entries > article.entry').each((idx, el) => arr.push({
			title: $(el).find('a').attr('title'),
			type: $(el).find('span.type').text(),
			status: $(el).find('div.status').text(),
			score: $(el).find('div.score').text().trim(),
			cover: $(el).find('img').attr('src'),
			url: 'https://212.32.226.234' + $(el).find('a').attr('href')
		}))
		return arr
	} else if (/^download$/i.test(type)) {
		let html = (await axios.get(uri)).data, $ = cheerio.load(html)
		return {
			title: $('h1').text(),
			pages: Object.entries($('div.main > div > img')).map(v => v[1]?.attribs?.['src']).filter(v => v),
			download: $('div.chright > span > a').attr('href')
		}
	} else if (/^detail$/i.test(type)) {
		let html = (await axios.get(uri)).data, $ = cheerio.load(html), obj = {}
		obj.title = $('div.wrapper').find('img').attr('title')
		obj.cover = $('div.wrapper').find('img').attr('src')
		obj.synonyms = $('div.wrapper').find('span.alter').text()
		$('div.wrapper').find('table > tbody > tr').each((idx, el) => {
			let str = $(el).find('td').eq(0).text().replace(/ /g, '_').toLowerCase()
			obj[str] = $(el).find('td > a').text() || $(el).find('div.rating-prc').text() || $(el).find('td').eq(1).text()
		})
		obj.genre = $('div.tags > a').get().map((v) => $(v).attr('title')).join(', ')
		obj.synopsis = $('div.pb-2 > p').get().map((v) => $(v).text()).filter(v => !/Download Batch/.test(v)).join('\n\n').replace('Sinopsis:', '').trim()
		obj.chapter_list = {}
		$('#chapter_list > ul > li').each((idx, el) => obj.chapter_list['chapter_' + $(el).find('div.epsright').text().replace(/\D/g, '')] = {
			title: $(el).find('div.epsleft > span > a').text(),
			date: $(el).find('div.epsleft > span.date').text(),
			url: 'https://212.32.226.234' + $(el).find('a').attr('href'),
			download: $(el).find('div.chright > span > a').attr('href')
		})
		return obj
	} else {
		throw 'Type not supported'
	}
}
