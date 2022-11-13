const axios = require('axios')
const cheerio = require('cheerio')

class Urlebird {
	#get = async (param) => {
		let html = (await axios.get(`https://urlebird.com/${encodeURI(param)}/`)).data
		let $ = cheerio.load(html)
		return $('div.thumb').get().map(x => encodeURI($(x).find('a').eq(2).attr('href')))
	}
	
	detailVideo = async (url) => {
		let html = (await axios.get(url)).data
		let $ = cheerio.load(html), obj = { author: {}, video: {} }
		let video = $('div.video > div:nth-child(2)').find('div.row')
		let info = $('div.info > span').get().map(x => $(x).text())
		obj.author.username = video.text().match(/@(.*)/)?.[0]
		obj.author.followers = video.text().match(/(.*) followers/)?.[1]
		obj.author.avatar = video.find('img').attr('src')
		obj.video.post = video.text().match(/Posted (.*)/)?.[1]
		obj.video.play = info?.[0]
		obj.video.likes = info?.[1]
		obj.video.comments = info?.[2]
		obj.video.share = info?.[3]
		obj.video.music = $('div.music').text().trim()
		obj.video.description = $('div.info2').text().trim()
		obj.video.url = $('video').attr('src')
		obj.video.url2 = `https://tiktok.com/${obj.author.username}/video/${url.split('-').slice(-1)}`
		return obj
	}
	
	latest = async () => {
		let arr = []
		for (let data of await this.#get('videos')) arr.push(await this.detailVideo(data))
		return arr
	}
	
	popular = async () => {
		let arr = []
		for (let data of await this.#get('videos/popular')) arr.push(await this.detailVideo(data))
		return arr
	}
	
	trending = async () => {
		let arr = []
		for (let data of await this.#get('trending')) arr.push(await this.detailVideo(data))
		return arr
	}
	
	user = async (username) => {
		let html = (await axios.get(`https://urlebird.com/user/${username}/`)).data
		let $ = cheerio.load(html), obj = {}
		let img = $('img.user-image')
		let stats = $('div.content').find('div.row > div').get().map(x => $(x).text())
		obj.name = img.attr('alt').split(' - ')?.[1]
		obj.username = img.attr('alt').split(' - ')?.[0]
		obj.likes = stats?.[0]
		obj.followers = stats?.[1]?.replace(' followers', '')
		obj.following = stats?.[2]?.replace(' following', '')
		obj.description = $('div.content > p').text()
		obj.avatar = img.attr('src')
		obj.videos = []
		for (let x of await this.#get(`user/${username}`)) obj.videos.push(await this.detailVideo(x))
		return obj
	}
	
}

module.exports = new Urlebird()
