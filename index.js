const fs = require('fs')
const jimp = require('jimp')
const axios = require('axios')
const morgan = require('morgan')
const express = require('express')
const PDFDocument = require('pdfkit')
const FormData = require('form-data')
const bodyParser = require('body-parser')

const app = express()

app.use(morgan('tiny'))
app.use(bodyParser.json())
app.set('json spaces', 2)

app.get('/', (req, res) => {
  res.json({ message: 'i don\'t have idea what i\'am doing' })
})

app.post('/imagetopdf', async (req, res) => {
  try {
    let { images, filename } = req.body
    if (!images) return res.json({ success: false, msg: 'Required an image url or buffer' })
    if (!(filename && filename.endsWith('pdf'))) filename = `${~~(Math.random() * 1e9)}.pdf`
    let buffer = await toPDF(images)
    console.log(images.length, filename)
    await fs.writeFileSync(process.cwd() + `/${filename}`, buffer)
    res.json(await uploadFile(filename))
  } catch (e) {
    res.json({ message: String(e) })
  }
})

const listener = app.listen(process.env.PORT || ~~(Math.random() * 1e4), () => {
  console.log('App running on port', listener.address().port)
})

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function toPDF(images, opt = {}) {
  return new Promise(async (resolve, reject) => {
    if (!Array.isArray(images)) images = [images]
    let buffs = [], doc = new PDFDocument({ autoFirstPage: false })
    for (let image of images) {
      let data = Buffer.isBuffer(image) ? image : (await axios.get(image, { responseType: 'arraybuffer', ...opt })).data
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
  form.append('files[]', fs.createReadStream(path))
  let res = await axios({
    url: 'https://uguu.se/upload.php',
    method: 'post',
    headers: {
      ...form.getHeaders()
    },
    data: form
  })
  // await fs.promises.unlink(path)
  return res.data.files[0]
}
