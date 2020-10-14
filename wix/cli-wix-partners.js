const WixSupport = require('./wixSupport').WixSupport;
const config = require('@nimacode/core/lib/config');
const logger = require('@nimacode/core/lib/utils/log').getLogger(__filename);
const shutdownLogs = require('@nimacode/core/lib/utils/log').shutdownLogs;
const util = require('util');
const WantherdressParser = require('./wantherdress').WantherdressParser;
const commander = require('commander');
const async = require('async');

class WixPartners{
    /**
     *
     * @param {string} partner - partner organization name
     * @param {string} outputFile - path to output file
     */
    constructor(partner, outputFile) {
        this.partner = partner;
        this.outputFile = outputFile;
        this.configTokenKey = util.format('wix_auth_token_%s', partner);
        this.tokenPartner = config[this.configTokenKey];
        this.tokenAmby = config.wix_auth_token;
        this.wixSupportPartner = new WixSupport(this.tokenPartner);
        this.wixSupportAmby = new WixSupport(this.tokenAmby);
        this.existingSku = [];
        this.partnersParsers = {
            "wantherdress": WantherdressParser
        };
        this.partnersParser = this.getParser();
        this.csvHeader = [['handleId', 'fieldType', 'name', 'description', 'productImageUrl', 'collection',
            'sku', 'ribbon', 'price', 'surcharge', 'visible', 'discountMode', 'discountValue',
            'productOptionName2', 'productOptionType2', 'productOptionDescription2']];
    }

    /**
     * Getting partners parser
     * @return {*}
     */
    getParser(){
        if (this.partnersParsers.hasOwnProperty(this.partner))
            return this.partnersParsers[this.partner];
        else
            logger.error('Unable to find partners parser');
    }

    /**
     * Getting raw partners feed
     * @param {function} done
     */
    getFeed(done){
        this.wixSupportPartner.generateRawFeed(feed => {
            done(feed);
        })
    }

    /**
     * Processing partners feed
     * @param {Array} feed
     * @param {function} done
     */
    processFeed(feed, done){
        const parser = new this.partnersParser(feed);
        parser.process(done);
    }

    /**
     * Collecting partners feed
     */
    collectPartnersFeed(){
        logger.debug('Partner: ', this.partner);
        const convertToExport = this.convertToExport.bind(this);

        this.getFeed(feed => {
            this.processFeed(feed, processedFeed => {
                this.wixSupportAmby.generateRawFeed(feed => {
                    this.ambyFeed = feed;
                    this.itemSlugs = feed?.map(item => item.slug);

                    async.mapLimit(processedFeed, 4, convertToExport
                        , (err, formattedItems) => {
                        if (err)
                            logger.error(err);

                        const items = formattedItems.filter(item => item);

                        this.csvHeader.push(...items);

                        this.wixSupportAmby.save(this.csvHeader, this.outputFile, this.partner, () => {
                            setTimeout(shutdownLogs, 2000, (err) => {
                                process.exit();
                            });
                        });
                    });

                });
            }) ;
        });
    }

    /**
     * Converting partners feed to wix exporting format
     * @param {Object} item
     * @param {function} cb
     */
    convertToExport(item, cb) {
        const ambyIdx = this.itemSlugs.indexOf(item.slug);
        const ambyItem = ambyIdx !== -1 ? this.ambyFeed[ambyIdx] : undefined;
        const handleId = util.format('Product_%s', item.slug);
        this.wixSupportAmby.resizeImages(item?.media?.items?.map(i => i?.image?.url), (urls) => {
            const productImageUrl = urls;
            const visible = this.wixSupportAmby.getUpdatedStockState(item);
            const discountMode = item.discount?.type === 'NONE' ? '' : item.discount?.type;
            const discountValue = item.discount?.type === 'NONE' ? '' : item.discount?.value;
            this.wixSupportAmby.getUpdatedSizes(ambyItem, sizesUpdated => {
                const partnerSizes = item.productOptions?.map(option => option?.value);
                const sizes = sizesUpdated ?? partnerSizes.join(';');

                this.wixSupportAmby.getUpdatedCollections(ambyItem, collections => {
                    const collection = collections ?? '';
                    this.wixSupportAmby.getUpdatedDescription(ambyItem, description => {
                        const newDescription = description ?? item.description;
                        const newItem = [handleId, 'Product', item.name, newDescription, productImageUrl,
                            collection, item.sku, '', item.price.price, '', visible, discountMode, discountValue];

                        newItem.push(...['Размер', 'DROP_DOWN', sizes ?? '']);

                        if (this.existingSku.indexOf(item.sku) === -1){
                            this.existingSku.push(item.sku);
                            cb(null, newItem);
                        }else{
                            logger.debug('Item with such sku already exists: ', item.sku);
                            cb(null, null);
                        }
                    });
                });
            });
        });
    }
}

commander.version('0.3');

commander.command('collect')
    .description('Collect partners wix feed')
    .option('-o, --output <output_file>', 'wix feed file', './cli/wix/export1.csv')
    .option('-p, --partner <partner_name>', 'name of the partner', 'wantherdress')
    .action(cmd => {
        const wixPartners = new WixPartners(cmd.partner, cmd.output);
        wixPartners.collectPartnersFeed();
    });

commander.parse(process.argv);