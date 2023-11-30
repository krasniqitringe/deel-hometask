const express = require('express');
const bodyParser = require('body-parser');
const {sequelize} = require('./model')
const {getProfile} = require('./middleware/getProfile')
const app = express();
app.use(bodyParser.json());
app.set('sequelize', sequelize)
app.set('models', sequelize.models)

const { Op, col, fn, literal } = require('sequelize');


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

/**
 * @returns all unpaid jobs for a user
 */

app.get('/jobs/unpaid', getProfile, async (req, res) => {
    const { Contract, Job } = req.app.get('models');
    const profile_id = req.profile.dataValues.id;

    try {
        const unpaidJobs = await Job.findAll({
            include: {
                model: Contract,
                where: {
                    [Op.and]: [
                        { [Op.or]: [{ ClientId: profile_id }, { ContractorId: profile_id }] },
                        { status: { [Op.not]: 'terminated' } },
                    ],
                },
            },
            where: {
                [Op.or]: [
                    { paid: { [Op.eq]: false } },
                    { paid: { [Op.eq]: null } },
                ],
            },
        });

        res.status(200).json(unpaidJobs);
    } catch (error) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

/**
 * @returns success when job paid 
 */

app.post('/jobs/:job_id/pay', getProfile, async (req, res) => {
    const { Profile, Job, Contract } = req.app.get('models');
    const { job_id } = req.params;

    try {
        const job = await Job.findByPk(job_id, {
            include: [
                {
                  model: Contract,
                  include: [
                    { model: Profile, as: 'Client' },
                    { model: Profile, as: 'Contractor' },
                  ],
                },
              ]
        });

        if (!job) {
            return res.status(404).json({ error: 'Job not found' });
          }

        if(job.paid == true) {
            return res.status(400).json({ error: 'Job has already been paid!' });
        }

        const profile = job.Contract.Client;
        const contractor = job.Contract.Contractor

        if (profile.balance >= job.price) {
            const client_final_balance = profile.balance - job.price;
            const contractor_final_balance = contractor.balance + job.price;

            await profile.update({ balance: client_final_balance });
            await contractor.update({ balance: contractor_final_balance });
            await job.update({paid: true, paymentDate: new Date() });

        } else {
            return res.status(400).json({ error: 'Not enough money in your balance!' });
        }

        return res.status(200).json({message: "Success"});
    } catch (error) {
        return res.status(500).json({ error: 'Internal Server Error' });
    }
});


app.post('/balances/deposit/:userId', async (req, res) => {
    const userId = req.params.userId;
    const { Profile, Job, Contract } = req.app.get('models');
  
    try {
  
      if(!req.body.amount){
          return res.status(400).json({ error: 'Please add amount' });
      }
      const client = await Profile.findByPk(userId);
  
      if (!client || client.type !== 'client') {
        return res.status(404).json({ error: 'Client not found' });
      }
  
      const unpaidJobs = await Job.findAll( {
          attributes: [[fn('SUM', col('price')), 'totalUnpaid']],
          include: {
              model: Contract,
              where: {
                  [Op.and]: [
                      { ClientId: userId },
                      { status: { [Op.not]: 'terminated' } },
                  ],
              },
          },
          where: {
              [Op.or]: [
                  { paid: { [Op.eq]: false } },
                  { paid: { [Op.eq]: null } },
              ],
          },
          raw: true, 
      });
  
      const totalUnpaid = unpaidJobs.length > 0 ? unpaidJobs[0].totalUnpaid : 0;
      const depositAmount = parseFloat(req.body.amount);
      const maxDeposit = 0.25 * totalUnpaid;
  
      if (depositAmount > maxDeposit) {
        return res.status(400).json({ error: 'Deposit exceeds 25% of total jobs to pay!' });
      }
  
      await client.update({
        balance: client.balance + depositAmount,
      });
  
      return res.status(200).json({ message: 'Deposit successfully finished' });
    } catch (error) {
        console.log(error)
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  });
  

app.get('/admin/best-profession', async (req, res) => {
    const { start, end } = req.query;

    try {
        const result = await sequelize.query(
            `
            SELECT p.profession, SUM(j.price) AS totalEarned
            FROM Profiles p
            JOIN Contracts c ON p.id = c.ContractorId
            JOIN Jobs j ON c.id = j.ContractId
            WHERE j.paid = true
              AND j.paymentDate BETWEEN :start AND :end
            GROUP BY p.profession
            ORDER BY totalEarned DESC
            LIMIT 1
          `,
            {
              replacements: { start, end },
              type: sequelize.QueryTypes.SELECT,
            }
          );


        return res.status(200).json(result[0]);

    } catch (error) {
      return res.status(500).json({ error: 'Internal Server Error' });
    }
});


app.get('/admin/best-clients', async (req, res) => {
    try {
      const { start, end, limit = 2 } = req.query;
      const { Profile } = req.app.get('models');

  
      const startDate = start ? new Date(start) : null;
      const endDate = end ? new Date(end) : new Date();
  
      const bestClients = await Profile.findAll({
        attributes: [
          'id',
          'firstName',
          [literal('(SELECT SUM(price) FROM Jobs WHERE ContractId IN (SELECT id FROM Contracts WHERE ClientId = Profile.id) AND paid = true AND paymentDate BETWEEN :startDate AND :endDate)'), 'paid'],
        ],
        replacements: { startDate, endDate },
        where: {
          type: 'client',
        },
        group: ['Profile.id'],
        order: [[literal('paid'), 'DESC']],
        limit: parseInt(limit),
      });
      
      
      res.status(200).json(bestClients);
    } catch (error) {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });


module.exports = app;
