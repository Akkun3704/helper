const fs = require('fs')
const jimp = require('jimp')
const path = require('path')
const axios = require('axios')
const morgan = require('morgan')
const cheerio = require('cheerio')
const express = require('express')
const FormData = require('form-data')
const PDFDocument = require('pdfkit')
const bodyParser = require('body-parser')

const tmpFolder = path.join(__dirname, './tmp')
const app = express()

app.use(morgan('tiny'))
app.use(bodyParser.json())
app.set('json spaces', 2)

app.use((req, res, next) => {
  clearTmp()
  next()
})

app.get('/', (req, res) => {
  res.json({ message: 'still in development, i guess...' })
})

app.post('/imagetopdf', async (req, res) => {
  try {
    let { images, filename } = req.body
    if (!images) return res.json({ message: 'Required an image url' })
    if (!(filename && filename.endsWith('pdf'))) filename = `${~~(Math.random() * 1e9)}.pdf`
    let buffer = await toPDF(images)
    console.log(images.length, filename)
    await fs.writeFileSync(path.join(tmpFolder, filename), buffer)
    res.json(await uploadFile(path.join(tmpFolder, filename)))
  } catch (e) {
    res.json({ message: String(e) })
  }
})

app.get('/fetch', async (req, res) => {
  try {
    if (!req.query.url) return res.redirect('/')
    let json = await axios.get(req.query.url)
    res.json(json.data)
  } catch (e) {
    res.send(e)
  }
})

app.get('/buffer', async (req, res) => {
  try {
    if (!req.query.url) return res.redirect('/')
    let data = await axios.get(req.query.url, { responseType: 'arraybuffer' })
    res.writeHead(200, {
      'Content-Type': data.headers['content-type'] || data.headers['Content-Type'],
      'Content-Length': data.data.length
    })
    res.end(data.data)
  } catch (e) {
    res.send(e)
  }
})

const listener = app.listen(process.env.PORT || ~~(Math.random() * 1e4), () => {
  console.log('App running on port', listener.address().port)
})

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

async function toPDF(images, opt = {}) {
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

async function uploadFile(path) {
  let form = new FormData
  form.append('file', fs.createReadStream(path))
  let res = await axios({
    url: 'https://api.anonfiles.com/upload',
    method: 'post',
    data: form,
    headers: {
      ...form.getHeaders()
    },
    maxContentLength: Infinity,
    maxBodyLength: Infinity
  })
  // await fs.promises.unlink(path)
  if (res.data.success) {
    let file = res.data.data.file, $ = cheerio.load(file.url.full)
    return {
      url: $('#download-url').atrr('href'),
      shorturl: file.url.short,
      name: file.metadata.name,
      size: file.metadata.size.readable
    }
  }
  return res
}
