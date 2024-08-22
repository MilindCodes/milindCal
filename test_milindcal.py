from milindcal import generating_tasks, task_sort, generate_file
import unittest, os
from unittest.mock import patch
from milindcal import Task


class test_generating_tasks(unittest.TestCase):

    @patch('builtins.input')
    def test_generating_tasks(self, mock_input):
        mock_input.side_effect = ["Yes", "Walk Dogs", "Walk dogs when you get home", 30, "!!", "yep", "Drink Water", "Make sure to drink water after walking dogs", 1, "!!!", "no"]

        result = generating_tasks()

        self.assertIsInstance(result, list)

        self.assertEqual(len(result),2)

        for task in result:
            self.assertIsInstance(task, Task)
        
        self.assertEqual(result[0].title, "Walk Dogs")
        self.assertEqual(result[0].description, "Walk dogs when you get home")
        self.assertEqual(result[0].importance, "!!")
        self.assertEqual(result[0].duration, 30)

        self.assertEqual(result[1].title, "Drink Water")
        self.assertEqual(result[1].description, "Make sure to drink water after walking dogs")
        self.assertEqual(result[1].importance, "!!!")
        self.assertEqual(result[1].duration, 1)

class test_task_sort(unittest.TestCase):
    @patch('builtins.input')
    def test_task_sort(self, mock_input):
        mock_task_1 = Task("Walk dogs", "Walk dogs when you get home", 25, "!!")
        mock_task_2 = Task("Drink Water", "Make sure to drink water after walking dogs", 1, "!!!")
        mock_task_3 = Task("Pet cats", "Make sure to pet cats so they have fun", 5, "!!!")
        mock_task_4 = Task("Learn French", "Make sure to practice Frensh on Duolingo", 10, "!")

        mock_input = [mock_task_1, mock_task_2, mock_task_3, mock_task_4]
        temp_list = []
        result = task_sort(mock_input)
        self.assertIsInstance(result, list)
        self.assertEqual(len(result), 4)
        for task in result:
            self.assertIsInstance(task, dict)
        for dictN in result:
            for key in dictN.keys():
                title = key.title
                temp_list.append(title)
        
        self.assertEqual(temp_list[0], "Drink Water")
        self.assertEqual(temp_list[1], "Pet cats")
        self.assertEqual(temp_list[2], "Walk dogs")
        self.assertEqual(temp_list[3], "Learn French")

class test_file_creation(unittest.TestCase):

    def test_file_creation(self):
        test_filename = "tasks"

        mock_task_1 = Task("Walk dogs", "Walk dogs when you get home", 25, "!!")
        mock_task_2 = Task("Drink Water", "Make sure to drink water after walking dogs", 1, "!!!")
        mock_task_3 = Task("Pet cats", "Make sure to pet cats so they have fun", 5, "!!!")
        mock_task_4 = Task("Learn French", "Make sure to practice Frensh on Duolingo", 10, "!")

        mock_input = [{mock_task_1: 1}, {mock_task_2: 2}, {mock_task_3: 3}, {mock_task_4: 4}]

        generate_file(mock_input)

        self.assertTrue(os.path.exists(test_filename))

        os.remove(test_filename)



    
if __name__ == '__main__':
    unittest.main()