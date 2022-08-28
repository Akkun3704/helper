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

app.get('/nhentai', async (req, res) => {
	try {
		if (req.query.code) {
			let result = await nhentaiScraper(req.query.code)
			if (!result) return res.json({ message: 'Code not exists' })
			res.json({ result })
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

app.get('/download/:path', async (req, res) => {
	try {
		let filename = req.params.path
		res.download(path.join(tmpFolder, filename), filename)
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

async function nhentaiScraper(id) {
	let uri = id ? `https://cin.guru/v/${+id}/` : 'https://cin.guru/'
	let html = (await axios.get(uri)).data
	return JSON.parse(html.split('<script id="__NEXT_DATA__" type="application/json">')[1].split('</script>')[0]).props.pageProps.data
}
