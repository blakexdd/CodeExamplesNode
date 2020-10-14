const request = require('request');
const logger = require('@nimacode/core/lib/utils/log').getLogger(__filename);
const async = require('async');
const config = require('@nimacode/core/lib/config');
const WixSupport = require('../wix/wixSupport').WixSupport;
const wixSupportAmby = new WixSupport(config.wix_auth_token);
const util = require('util');

function collectFeed(done){
    const options = {
        method: "GET",
        url: "http://crm.bewearcy.com/api/gettovar"
    }

    request(options, (err, res) => {
        if (err)
            logger.error(err);

        done(JSON.parse(res.body).products);
    });
}

class BewearcyParser{
    /**
     *
     * @param {Array} feed
     * @param {string} filename
     */
    constructor(feed, filename) {
        this.feed = feed;
        this.filename = filename;
        this.sizesTranslation = {
            "42": "XS",
            "44": "S",
            "46": "M",
            "48": "L",
            "50": "XL"
        }
    }

    /**
     * Converting bewearcy feed to amby feed
     * @param {function} done
     */
    process(done){
        wixSupportAmby.readData(this.filename, (err, data) => {
            if (err)
                logger.error(err);


            async.map(this.feed, (feed, cb) => {
                const slug = feed.name.toLowerCase().replace(/\s+/g, '-');
                const handleId = util.format('Product_%s', slug);
                const productImageUrl = feed.img.join(';');
                const visible = 'TRUE';
                const discountMode = '';
                const discountValue = '';
                const fieldType = 'Product';
                const description = feed.description;
                const collection = '';
                const sku = '';
                const ribbon = '';
                const price = Number(feed.price.split('.')[0]) + config.bewearcy_markup;
                const surcharge = '';
                const productOptionName = 'Размер';
                const productOptionType = 'DROP_DOWN';
                const productOptionDescription = this.generateSizes(feed.size);

                const feedItem = [handleId, fieldType, feed.name, description, productImageUrl, collection,
                    sku, ribbon, price, surcharge, visible, discountMode, discountValue, productOptionName,
                    productOptionType, productOptionDescription];

                cb(null, feedItem);
            }, (err, items) => {
                if (err)
                    logger.error(err);

                logger.debug('filename: ', this.filename);

                const newItems = this.feed.map(item => item.name);
                const outdatedItems = data?.filter(item => newItems.indexOf(item.name) !== -1);

                items.push(outdatedItems?.map(item => {
                   item.visible = 'FALSE';

                   return item;
                }));

                done(items);
            });
        });
    }

    generateSizes(size){
        if (this.sizesTranslation.hasOwnProperty(size)){
            return this.sizesTranslation[size];
        }else
            return size;
    }
}

module.exports = {
    bewearcyLoader: collectFeed,
    BewearcyParser: BewearcyParser
}