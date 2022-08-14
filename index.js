const fs = require('fs')
const jimp = require('jimp')
const path = require('path')
const axios = require('axios')
const morgan = require('morgan')
const cheerio = require('cheerio')
const express = require('express')
const PDFDocument = require('pdfkit')

const tmpFolder = path.join(__dirname, './tmp')
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
	let baseUrl = `${req.protocol}://${req.get('host')}`
	res.json({
		runtime: new Date(process.uptime() * 1000).toTimeString().split(' ')[0],
		result: {
			nhentai: {
				latest: `${baseUrl}/nhentai`,
				detail: `${baseUrl}/nhentai?code=353331`,
				download: `${baseUrl}/nhentai/353331`
			},
			tools: {
				buffer: `${baseUrl}/buffer?url=https://i.waifu.pics/dQ8bv0m.png`,
				fetch: `${baseUrl}/fetch?url=${baseUrl}`
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
		res.set({
			'Content-Disposition': `attachment; filename=${filename}`,
			'Content-Type': 'application/pdf',
			'Content-Length': buffer.length
		})
		res.end(buffer)
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

app.get('/nhentai', async (req, res) => {
	try {
		if (req.query.code) {
			let data = await nhentaiScraper(req.query.code)
			if (!data) return res.json({ message: 'Code not exists' })
			res.json({ result: data })
		}
		let data = (await nhentaiScraper()).all, arr = []
		for (let x of data) arr.push({
			id: x.id, title: x.title, pages: x?.num_pages || '',
			cover: x.cover?.t?.replace(/a.kontol|b.kontol/, 'c.kontol') || x.cover?.replace(/a.kontol|b.kontol/, 'c.kontol')
		})
		res.json({ result: arr })
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
		let buffer = await toPDF(pages)
		await sleep(5000)
		res.set({
			'Content-Disposition': `attachment; filename=${data.id}.pdf`,
			'Content-Type': 'application/pdf',
			'Content-Length': buffer.length
		})
		res.end(buffer)
	} catch (e) {
		res.json({ message: String(e) })
	}
})

const listener = app.listen(process.env.PORT || ~~(Math.random() * 1e4), () => {
	console.log('App running on port', listener.address().port)
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
		let buffs = [], doc = new PDFDocument({ autoFirstPage: false })
		for (let image of images) {
			// let data = Buffer.isBuffer(image) ? image : (await axios.get(image, { responseType: 'arraybuffer', ...opt })).data
			let data = (await axios.get(image, { responseType: 'arraybuffer', ...opt })).data
			let { width, height } = (await jimp.read(data)).bitmap
			doc.addPage({ size: [width, height] })
			doc.image(data, 0, 0)
			// doc.image(data, 0, 0, { align: 'center', valign: 'center' })
			// doc.addPage({ size: [width, height] })
		}
		doc.on('data', (chunk) => buffs.push(chunk))
		doc.on('end', () => resolve(Buffer.concat(buffs)))
		doc.on('error', (err) => reject(err))
		doc.end()
	})
}

async function nhentaiScraper(id) {
	let uri = id ? `https://cin.guru/v/${+id}/` : 'https://cin.guru/'
	let html = (await axios.get(uri)).data
	return JSON.parse(html.split('<script id="__NEXT_DATA__" type="application/json">')[1].split('</script>')[0]).props.pageProps.data
}
