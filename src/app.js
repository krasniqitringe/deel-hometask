const express = require('express');
const bodyParser = require('body-parser');
const {sequelize} = require('./model')
const {getProfile} = require('./middleware/getProfile')
const app = express();
app.use(bodyParser.json());
app.set('sequelize', sequelize)
app.set('models', sequelize.models)

const { Op } = require('sequelize');


/**
 * FIX ME!
 * @returns contract by id
 */

app.get('/contracts/:id', getProfile, async (req, res) => {
    const { Contract } = req.app.get('models');
    const { id } = req.params;
    const profile_id = req.profile.dataValues.id;

    try {
        const contract = await Contract.findOne({
            where: {
                [Op.and]: [
                    { [Op.or]: [{ ClientId: profile_id }, { ContractorId: profile_id }] },
                    {id: id}
                ],
            },
        });

        if (!contract) {
            return res.status(404).json({ error: 'Contract not found!' });
        }

        res.status(200).json(contract);
    } catch (error) {
        console.log(error)
        res.status(500).json({ error: 'Internal Server Error' });
    }

});

/**
 * @returns a list of contracts belonging to a user
 */

app.get('/contracts', getProfile, async (req, res) => {
    const { Contract } = req.app.get('models');
    const profile_id = req.profile.dataValues.id;
    try {
        const contracts = await Contract.findAll({
            where: {
                [Op.and]: [
                    { [Op.or]: [{ ClientId: profile_id }, { ContractorId: profile_id }] },
                    { status: { [Op.not]: 'terminated' } },
                ],
            },

        });

        res.status(200).json(contracts);
    } catch (error) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});


module.exports = app;
