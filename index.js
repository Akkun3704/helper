const fs = require('fs')
const path = require('path')
const axios = require('axios')
const morgan = require('morgan')
const cheerio = require('cheerio')
const express = require('express')
const PDFDocument = require('pdfkit')

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
				download: `${baseUrl}/doujindesu/download?url=https://212.32.226.234/2022/09/02/illicit-love-chapter-34`
			},
			nhentai: {
				latest: `${baseUrl}/nhentai`,
				detail: `${baseUrl}/nhentai?code=353331`,
				download: `${baseUrl}/nhentai/353331`
			},
			tools: {
				buffer: `${baseUrl}/buffer?url=https://i.waifu.pics/dQ8bv0m.png`,
				fetch: `${baseUrl}/fetch?url=${baseUrl}`,
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

app.get('/nhentai', async (req, res) => {
	try {
		if (req.query.code) {
			let result = await nhentaiScraper(req.query.code)
			if (!result) return res.json({ message: 'Code not exists' })
			return res.json({ result })
		}
		let data = (await nhentaiScraper()).all, result = []
		for (let x of data) result.push({
			id: x.id, title: x.title, pages: x?.num_pages || '',
			cover: x.cover?.t?.replace(/a.kontol|b.kontol/, 'c.kontol') || x.cover?.replace(/a.kontol|b.kontol/, 'c.kontol')
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

async function nhentaiScraper(id) {
	let uri = id ? `https://cin.guru/v/${+id}/` : 'https://cin.guru/'
	let html = (await axios.get(uri)).data
	return JSON.parse(html.split('<script id="__NEXT_DATA__" type="application/json">')[1].split('</script>')[0]).props.pageProps.data
}

async function doujindesuScraper(type = 'latest', query) {
	let uri = /^latest$/i.test(type) ? 'https://212.32.226.234/' : /^search$/i.test(type) ? `https://212.32.226.234/?s=${query}` : query
	if (/^latest$/i.test(type)) {
		let html = (await axios.get(uri)).data
		let $ = cheerio.load(html), arr = []
		$('div.animposx').each((idx, el) => arr.push({
			title: $(el).find('a').attr('alt'),
			chapter: $(el).find('div.plyepisode').find('a').text().trim(),
			type: $(el).find('div.type').text(),
			score: $(el).find('div.score').text().trim(),
			cover: $(el).find('img').attr('src'),
			url: $(el).find('div.plyepisode').find('a').attr('href')
		}))
		return arr
	} else if (/^search$/i.test(type)) {
		let html = (await axios.get(uri)).data
		let $ = cheerio.load(html), arr = []
		$('div.animposx').each((idx, el) => arr.push({
			title: $(el).find('div.title').text().trim(),
			type: $(el).find('div.type').text().replace(/Publishing|Finished/i, ''),
			status: $(el).find('div.type').text().replace(/Manhwa|Manga|Doujinshi/i, ''),
			score: $(el).find('div.score').text().trim(),
			cover: $(el).find('img').attr('src'),
			url: $(el).find('a').attr('href')
		}))
		return arr
	} else if (/^download$/i.test(type)) {
		let html = (await axios.get(uri)).data
		let $ = cheerio.load(html)
		return {
			title: $('div.lm').find('h1').text(),
			pages: Object.entries($('div.reader-area').find('img')).map(v => v[1]?.attribs?.['src']).filter(v => v)
		}
	} else {
		throw 'Type not supported'
	}
}
