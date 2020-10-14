const bewearcyLoader = require('./bewearcy').bewearcyLoader;
const BewearcyParser = require('./bewearcy').BewearcyParser;
const logger = require('@nimacode/core/lib/utils/log').getLogger(__filename);
const config = require('@nimacode/core/lib/config');
const WixSupport = require('../wix/wixSupport').WixSupport;
const wixSupportAmby = new WixSupport(config.wix_auth_token);
const shutdownLogs = require('@nimacode/core/lib/utils/log').shutdownLogs;
const commander = require('commander');
const util = require('util');
const async = require('async');

class Partners{
    /**
     *
     * @param {string} partner - partner organization name
     * @param {string} outputFile - path to output file
     */
    constructor(partner, outputFile) {
        this.partner = partner;
        this.outputFile = util.format('%s_%s.csv', outputFile.slice(0, -4), this.partner);
        this.parsers = {
            "bewearcy": BewearcyParser
        };
        this.loaders = {
            "bewearcy": bewearcyLoader
        };
        this.load = this.getLoader();
        this.parser = this.getParser();
        this.ambyFeed = [];
        this.ambyNames = [];
        this.convertToExport = this.convertToExport.bind(this);
    }

    /**
     * Getting partners loader
     * @return {*}
     */
    getLoader(){
        if (this.loaders.hasOwnProperty(this.partner))
            return this.loaders[this.partner];
        else
            logger.error("No loader found");
    }

    /**
     * Getting partners parser
     * @return {*}
     */
    getParser(){
        if (this.parsers.hasOwnProperty(this.partner))
            return this.parsers[this.partner];
        else
            logger.error("No parser found");
    }

    /**
     * Loading processed partners feed
     * @param {function} done
     */
    loadProcessedItems(done){
        this.load(feed => {
            const parser = new this.parser(feed, this.outputFile);

            parser.process(items => {
                done(items);
            });
        });
    }

    /**
     * Collecting partners feed
     */
    collectPartnersFeed(){
        wixSupportAmby.generateRawFeed(ambyFeed => {
            this.ambyFeed = ambyFeed;
            this.ambyNames = ambyFeed.map(item => item.name);

            this.loadProcessedItems(items => {
                async.map(items,
                    this.convertToExport,
                    (err, res) => {
                        if (err)
                            logger.error(err);

                        const csvHeader = [wixSupportAmby.getCsvHeaders(), ...res];
                        wixSupportAmby.save(csvHeader, this.outputFile, this.partner, (err) => {
                            if (err)
                                logger.error(err);

                            setTimeout(shutdownLogs, 2000, (err) => {
                                process.exit();
                            });
                        });
                    });
            });
        });
    }

    /**
     * Converting feed to export format
     * @param {Array} item - feed item
     * @param {function} cb
     */
    convertToExport(item, cb){
        const ambyIdx = this.ambyNames.indexOf(item[2]);

        if (ambyIdx === -1)
            cb(null, item);
        else{
            const ambyItem = this.ambyFeed[ambyIdx];
            wixSupportAmby.getUpdatedDescription(ambyItem, description => {
                item[config.wix_feed_csv_description_idx] = description ?? item[config.wix_feed_csv_description_idx];

                wixSupportAmby.getUpdatedSizes(ambyItem, sizes => {
                   item[item.length - 1] = sizes ?? item[item.length - 1];

                   wixSupportAmby.getUpdatedCollections(ambyItem, collections => {
                      item[config.wix_feed_csv_collections_idx] = collections ?? item[config.wix_feed_csv_collections_idx];
                      item[config.wix_feed_csv_visible_idx] = wixSupportAmby.getUpdatedStockState(ambyItem);
                      cb(null, item);
                   });
                });
            });
        }
    }

}

commander.version('0.3');

commander.command('collect')
    .description('Collect partners feed')
    .option('-o, --output <output_file>', 'wix feed file', './cli/partners/export.csv')
    .option('-p, --partner <partner_name>', 'name of the partner', 'bewearcy')
    .action(cmd => {
        const partners = new Partners(cmd.partner, cmd.output);
        partners.collectPartnersFeed();
    });

commander.parse(process.argv);